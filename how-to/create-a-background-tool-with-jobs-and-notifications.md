# How to Create a Background Tool with Jobs and Agent Notifications

This guide shows how to add a DeepSeek Harness tool that begins as a normal
tool call, automatically becomes a background job when it outlives its initial
yield, retains its own unread output, and notifies the owning agent exactly
once when unattended work finishes.

The worked example is `dsh-codex-terminal` 0.1.3 and its `exec_command` plus
`write_stdin` contract. The architecture applies to other long-running tools,
but output ownership and completion delivery must be chosen deliberately for
each tool.

> Harness baseline: `dsh-v0.1.0-rc.8`. Verify the linked APIs again when
> upgrading DeepSeek Harness because Jobs, Agent scheduling, and tool runtime
> contracts are all versioned implementation surfaces.

## Outcome

The completed tool should follow this flow:

```text
agent calls start tool
        |
        v
tool starts one operation
        |
        v
wait through yield_time_ms
        |
        +-- operation finished
        |      |
        |      +-- return output + terminal status inline
        |          do not create a job
        |          do not send a completion notice
        |
        +-- operation still running
               |
               +-- register the existing operation with ctx.jobs
               +-- return one job_id
               |
               v
          operation later settles
               |
               +-- terminal result already returned by an active tool call?
               |      +-- yes: suppress completion notice
               |
               +-- killed or disposing?
               |      +-- yes: suppress natural-completion notice
               |
               +-- otherwise: steer the owner exactly once
                              |
                              v
                       owner calls the tool-specific reader
                       with the same job_id
```

## Before you begin

The host composition must provide the shared services, and the agent preset
must expose the tool-facing consumers.

For the Codex Shell pattern, the required pieces are:

```text
Host plane
  @deepseek-ai/dsh-jobs-local      ctx.jobs registry/provider
  agent runtime                    live Agent owner and turn driver

Agent-preset plane
  @deepseek-ai/dsh-tool-jobs       job_list, job_kill, job lifecycle controller
  your tool plugin                 start tool and tool-specific reader
```

If the tool registers work with `ctx.jobs`, fail during plugin activation when
the Jobs service is unavailable. Silently falling back to an unrelated private
job registry creates two incompatible job surfaces.

## 1. Separate the four contracts

Do not start with code. First decide who owns each part of the behavior.

| Contract | Owner in the Codex Shell pattern |
|---|---|
| Operation execution | Tool plugin |
| Job identity and lifecycle | `ctx.jobs` |
| Terminal input and unread output | `write_stdin` in the tool plugin |
| Model notification | Owning Agent through `steer` |

The important separations are:

```text
process exit is not automatically a model notification
job completion is not automatically terminal-output delivery
putting a message in an inbox is not automatically an agent wake
```

If the generic Jobs tools should own final output, provide the corresponding
Jobs output hook and use `job_output`. If a specialized tool such as
`write_stdin` owns the stream, do not also expose the same bytes through
`job_output`.

## 2. Define one public identifier

Avoid exposing both an internal session identifier and a job identifier. The
agent should receive one opaque `job_id` and use it everywhere:

```text
start tool     -> returns job_id
job_list       -> lists job_id
job_kill       -> accepts job_id
output reader  -> accepts job_id
notice         -> names job_id
```

For example:

```ts
export interface ExecResult {
  output: string
  wall_time_seconds: number
  job_id?: string
  exit_code?: number
  chunk_id?: string
  truncated?: boolean
  already_collected?: boolean
}

export interface WriteStdinArgs {
  job_id: string
  chars?: string
  yield_time_ms?: number
  max_output_tokens?: number
}
```

The identifier is opaque. Even if the backend has an operating-system PID or
an internal numeric session counter, neither should become part of the
model-facing contract.

## 3. Model the operation record

Keep the smallest state needed to coordinate execution, output, job lifecycle,
and notification ownership.

```ts
interface OperationRecord {
  readonly internalId: number
  readonly owner: AgentOwner
  readonly backend: OperationBackend
  readonly output: OutputLog
  readonly exitPromise: Promise<ExitStatus>

  jobId?: string
  exit?: ExitStatus
  activeOperation?: Promise<unknown>

  exposedToCaller: boolean
  notificationAttempted: boolean
  terminalReportedByTool: boolean
  jobCancelRequested: boolean
}
```

Each flag answers one question:

| Field | Question answered |
|---|---|
| `exposedToCaller` | Did the start tool return a background identifier? |
| `notificationAttempted` | Has the specialized completion notice already been attempted? |
| `terminalReportedByTool` | Did `exec_command` or `write_stdin` already return the exit? |
| `jobCancelRequested` | Is this cancellation rather than a natural completion? |
| `activeOperation` | Was a reader/writer call active when the backend exited? |

Do not infer these facts from timing alone. Store the state at the boundary
that owns it.

## 4. Start once, then decide at the yield boundary

The start tool should create one backend operation and wait only through the
configured initial yield.

```ts
async function executeCommand(request: StartRequest): Promise<ExecResult> {
  const record = await startBackend(request)
  const result = await waitForOutputOrExit(record, request.yieldTimeMs)

  if (result.exit_code !== undefined) {
    record.terminalReportedByTool = true
    return result
  }

  const jobId = promote(record, request.command, request.owner)
  record.exposedToCaller = true
  return { ...result, job_id: jobId }
}
```

The exact implementation may publish the record before waiting, but the
observable contract must have only two outcomes:

```text
finished in yield  -> terminal inline result, no job
still live         -> registered job_id, no terminal status yet
```

There is no need for a separate `run_in_background` parameter when automatic
promotion at `yield_time_ms` is the product contract.

### The yield-boundary race

The process may exit at the same instant the yield expires. Resolve that race
to exactly one branch:

```text
inline terminal result
or
registered job, possibly already terminal
```

It must never escape both branches, and it must never be returned inline while
also registering a second copy of the operation.

## 5. Register the existing operation with `ctx.jobs`

Promotion must adopt the already-running operation. Do not start it again.

The narrow Jobs contract needed by a producer is:

```ts
interface BackgroundJobOutcome {
  status: 'completed' | 'killed' | 'failed'
  detail?: string
}

interface BackgroundJobHooks {
  cancel(reason?: string): void
  done: Promise<BackgroundJobOutcome>
}

interface BackgroundJobs {
  start(spec: {
    kind: string
    label: string
    owner?: object
    run(): BackgroundJobHooks
  }): string
}
```

A minimal promotion looks like:

```ts
function promote(record: OperationRecord, label: string, owner: object): string {
  let settle!: (outcome: BackgroundJobOutcome) => void
  const done = new Promise<BackgroundJobOutcome>((resolve) => {
    settle = resolve
  })

  const jobId = jobs.start({
    kind: 'codex-terminal',
    label,
    owner,
    run: () => ({
      cancel: () => {
        if (record.jobCancelRequested) return
        record.jobCancelRequested = true
        void terminateAndJoin(record.backend)
      },
      done,
    }),
  })

  record.jobId = jobId
  void record.exitPromise.then(
    exit => settlePromoted(record, jobId, settle, outcomeFrom(exit, record)),
    error => settlePromoted(record, jobId, settle, {
      status: 'failed',
      detail: String(error),
    }),
  )
  return jobId
}
```

The job's `done` promise should settle only after the process has exited and
its output stream has reached its quiescence/closure boundary. Otherwise
`job_list` can say completed while the tool-specific reader is still missing
the final bytes.

## 6. Decide who owns completion output

There are two valid designs. Choose one.

### Generic Jobs output

Use this when the operation has one final result and no specialized streaming
or input protocol:

```text
background job settles
  -> job_output returns final result
```

### Tool-specific output

Use this for a terminal, stream, incremental log, interactive process, or
protocol-specific reader:

```text
background job settles
  -> notice names specialized reader
  -> write_stdin/read_log/read_result owns unread output
```

For Codex Shell:

```text
ctx.jobs owns:
  job_id
  running/stopping/completed/killed/failed
  job_list
  job_kill

write_stdin owns:
  unread terminal bytes
  stdin delivery
  output pagination
  exit_code rendering
```

Do not attach the full terminal output to the completion notice. That duplicates
content in the session log and can consume large context without advancing the
tool's own output cursor.

## 7. Suppress the generic Jobs notice when necessary

`@deepseek-ai/dsh-tool-jobs` normally listens for job settlement and creates a
generic completion notice. A producer that sends a specialized notice must
prevent both notices from reaching the model.

In the current Harness Jobs contract, attaching a terminal waiter before
settlement marks the generic notice as reported:

```ts
async function settlePromoted(
  record: OperationRecord,
  jobId: string,
  settle: (outcome: BackgroundJobOutcome) => void,
  outcome: BackgroundJobOutcome,
): Promise<void> {
  const activeAtExit = record.activeOperation
  const reported = jobs.wait(jobId, 30_000, record.owner).catch(() => undefined)

  settle(outcome)
  await reported
  await activeAtExit?.catch(() => undefined)

  if (shouldNotify(record)) notifyNaturalExit(record)
}
```

The waiter does not read the tool-specific output. It claims only the generic
Jobs completion delivery so the specialized notice remains the single
model-facing completion message.

Reverify this behavior against the installed Harness version. Do not assume
that an arbitrary future `wait()` implementation has the same reporting side
effect.

## 8. Understand Agent inbox and wake semantics

DeepSeek Harness separates where a message is placed from whether the Agent
driver is awakened.

```ts
followup(message) {
  this.send(message, 'next-turn', true)
}

steer(message) {
  this.send(message, 'next-step', true)
}

inject(message) {
  this.send(message, 'next-step', false)
}
```

The underlying send performs the inbox mutation first:

```ts
send(message, target, wakeup) {
  this.inbox.splice(target, Infinity, 0, [message])
  if (wakeup) this.wakeDriver(...)
}
```

The practical matrix is:

| Operation | Inbox target | Wakes an idle Agent? | Meaning |
|---|---|---:|---|
| Direct `inbox.append` | Chosen target | No | Passive storage only |
| `inject` | `next-step` | No | Context for a future natural step |
| `steer` | `next-step` | Yes | Existing work needs attention now |
| `followup` | `next-turn` | Yes | Independent ordinary later work |

The sentence to remember is:

> `next-step` means “consume this at the next step.” It does not mean “create a
> next step.”

An idle language model is not continuously reading its inbox. If the model
must react without another user message, the runtime must schedule a model
request.

## 9. Choose the completion delivery primitive

For command completion, use `steer`:

```ts
record.owner.steer(createCompletionNotice(record))
```

Why:

- The notice is context about a tool operation the Agent already started.
- A running Agent consumes it at its nearest later step.
- An idle Agent wakes in a new turn without waiting for user input.
- Multiple completions can enter the same `next-step` batch.
- The notice does not pretend to be a new human request.

### Why subagents may use a different branch

Continuable subagent settlement currently uses:

```ts
if (parent.status === 'idle') parent.followup(settlementMessage)
else parent.steer(settlementMessage)
```

A child Agent's final answer is an independent work product, so an ordinary
later turn is intentional when the parent is idle. A command-completion notice
is only a pointer back to the specialized output reader. Do not copy the
subagent state split solely for consistency of method names.

## 10. Build a compact completion notice

The message should say what settled and how to retrieve its result. It should
not embed the full output.

```ts
function createCompletionNotice(jobId: string, exit: ExitStatus): UserMessage {
  const code = exit.exitCode ?? 'unknown'
  const summary = `exec job ${jobId} exited with code ${code}`

  return createUserMessage({
    content: [{
      type: 'text',
      text: `${summary}. Call write_stdin with job_id=${JSON.stringify(jobId)} and chars="" to collect the remaining output.`,
    }],
    source: {
      kind: 'plugin',
      plugin: 'codex-terminal',
      form: 'notice',
      summary,
    },
  })
}
```

Use plugin provenance. Do not label runtime-authored completion text as if it
came from the human or from the background process itself.

## 11. Prevent double notification during an active read

The most important race occurs when the backend exits while `write_stdin` is
waiting.

```text
write_stdin starts waiting
        |
        v
backend exits
        |
        +-- exit callback observes completion
        |
        +-- write_stdin is preparing output + exit_code
```

If the exit callback immediately steers, the Agent receives both:

```text
write_stdin tool result: exited with code 0
completion notice: exited with code 0
```

Capture the operation that was active at exit, wait for it, and then inspect
whether it returned the terminal result:

```ts
const activeAtExit = record.activeOperation

settle(jobOutcome)
await genericNoticeClaim
await activeAtExit?.catch(() => undefined)

if (!record.terminalReportedByTool) {
  notifyNaturalExit(record)
}
```

Whenever a successful start/read operation constructs a result containing
`exit_code`, mark it before returning:

```ts
if (result.exit_code !== undefined) {
  record.terminalReportedByTool = true
}
```

This assigns one authoritative owner to each completion.

## 12. Use one notification state machine

Put all notification eligibility in one shared function instead of scattering
guards across the start tool, reader, job hook, and cleanup paths.

```ts
function notifyNaturalExit(record: OperationRecord): void {
  if (serviceDisposed || closedOwners.has(record.owner)) return
  if (!record.exposedToCaller) return
  if (record.notificationAttempted) return
  if (record.exit === undefined) return
  if (record.jobCancelRequested) return
  if (record.terminalReportedByTool) return
  if (record.owner.steer === undefined) return

  record.notificationAttempted = true
  try {
    record.owner.steer(createCompletionNotice(record.jobId!, record.exit))
  } catch {
    // Advisory delivery failure must not consume or delete tool output.
  }
}
```

The decision table is:

| Scenario | Terminal delivery owner | Specialized steer |
|---|---|---:|
| Exit inside initial start-tool yield | Start tool result | No |
| Exit inside active output-reader yield | Reader tool result | No |
| Natural exit between tool calls | Background completion path | Exactly one |
| Exit after a reader timed out without terminal status | Background completion path | Exactly one |
| Explicit `job_kill` | Cancellation path | No natural-exit steer |
| Owner teardown | Cleanup path | No |
| Plugin/service teardown | Cleanup path | No |

## 13. Suppress teardown wakes

Teardown often terminates the backend, which can look like an ordinary exit to
the exit observer. Without an explicit lifecycle guard, disposal may produce a
misleading notice such as:

```text
exec job codex-terminal-1 exited with code unknown
```

and wake an Agent the host is already destroying.

Mark lifecycle state before terminating owned operations:

```ts
async function closeOwner(owner: AgentOwner): Promise<void> {
  closedOwners.add(owner)
  await terminateEveryOperationOwnedBy(owner)
}

async function dispose(): Promise<void> {
  if (serviceDisposed) return
  serviceDisposed = true
  await terminateEveryOperation()
}
```

Then make lifecycle the first notification guard:

```ts
if (serviceDisposed || closedOwners.has(record.owner)) return
```

Do not replace teardown suppression with passive injection unless there is a
separate durable requirement for recording that message. Agent disposal can
clear unclaimed inbox work anyway.

## 14. Map `job_kill` onto the same backend

The Jobs cancel hook must terminate the operation that the start tool created.
It must not merely change the registry status.

```ts
cancel: () => {
  if (record.jobCancelRequested) return
  record.jobCancelRequested = true
  void terminateAndJoin(record.backend)
}
```

The job settles as killed only after the backend actually reaches its terminal
and output-quiescent state. This keeps `job_list`, process reality, and output
collection consistent.

Cancellation should be idempotent. Repeated `job_kill` requests must not launch
parallel teardown work or deliver multiple settlements.

## 15. Retain unread output after exit

Process exit is not permission to delete unread output. Keep the heavy record
until the reader returns all remaining bytes and the terminal status.

```text
running operation
  backend + output log + cursor + active-operation state
        |
        v
process exits
  retain record while unread output exists
        |
        v
reader returns final page + exit_code
  release backend/output references
        |
        v
lightweight completion tombstone
  job_id + owner + exit status + collected marker
```

The lightweight record makes repeated empty polls explicit:

```text
[job codex-terminal-1 exited with code 0; no unread output remains]
```

It should not retain the process, listeners, full output log, or other heavy
resources.

### Pagination

If one call is capped by `max_output_tokens`, return the same `job_id` together
with `exit_code` while more unread pages remain:

```ts
{
  job_id: 'codex-terminal-1',
  exit_code: 0,
  output: 'first page',
  truncated: true,
}
```

Continue empty polls until no unread page remains. A token cap limits one
response; it must not discard buffered output silently.

## 16. Install owner-scoped cleanup

The operation service should follow the Agent owner's Cordis lifecycle. When
available, register an owner-scoped effect:

```ts
owner.ctx.effect(
  () => async () => {
    await service.closeOwner(owner)
  },
  'tool owner cleanup',
)
```

Global plugin disposal remains the fallback for synthetic owners or contexts
already unwinding. Cleanup must be idempotent because job cancellation, owner
disposal, service disposal, and backend failure can converge.

## 17. Register the tools and prompt guidance

The start and reader tools should expose only their real public contract.

```text
exec_command
  cmd: string
  workdir?: string
  yield_time_ms?: number
  max_output_tokens?: number

write_stdin
  job_id: string
  chars?: string
  yield_time_ms?: number
  max_output_tokens?: number
```

Do not retain legacy parameters such as a separate `session_id` or add a
`run_in_background` switch when promotion is automatic.

The system prompt should explain:

- a command exceeding `yield_time_ms` returns one job ID;
- `job_list`, `job_kill`, and the specialized reader share that ID;
- the specialized reader, not `job_output`, owns terminal output;
- a completion notice will tell the Agent when it should collect unread output.

If `job_output` is intentionally unsupported for this job kind, hide it from
the preset's model-visible tool surface while keeping `tool-jobs` loaded for
job lifecycle controls.

## 18. Automated verification matrix

At minimum, leave tests for these cases:

### Foreground completion

```text
command exits before yield_time_ms
expect output + exit_code
expect no job_id
expect no job registration
expect no steer
```

### Background promotion

```text
command outlives yield_time_ms
expect one job_id
expect job_list shows same id
expect no session_id
```

### Natural completion between calls

```text
start returns job_id
command later exits
expect generic Jobs notice reported/suppressed
expect specialized steer exactly once
expect unread output still available from reader
```

### Exit inside active reader yield

```text
reader is waiting
command exits
expect reader returns output + exit_code
expect no specialized steer
```

### Reader returns before later exit

```text
reader yield expires without terminal status
command later exits
expect specialized steer exactly once
```

### Cancellation

```text
job_kill requests backend termination
expect job settles killed
expect no natural-completion steer
```

### Owner and service teardown

```text
teardown terminates backend
expect no steer
expect no misleading unknown-exit notification
```

### Repeated collection

```text
first reader call returns terminal output
second empty reader call returns explicit already-collected status
expect no duplicate output
expect no unknown-session error
```

## 19. Live event-order verification

Mocked tests prove which method was called. A live Harness run proves that the
Agent driver actually responds as intended.

Use a command that completes after the start tool's yield:

```text
1. Start a command that sleeps briefly, prints a unique marker, and exits.
2. Use a short initial yield so exec_command returns job_id.
3. End the Agent's first turn without calling the reader.
4. Do not send another user message.
5. Observe the completion-driven turn.
6. Confirm the Agent calls the specialized reader and receives the marker.
```

The expected persisted event order is:

```text
turn/end                     first turn finished
agent/inbox/spliced          target=next-step, source.kind=plugin
turn/start                   new turn without an intervening user enqueue
agent/inbox/spliced          completion message claimed
user/message                 plugin completion context
tool/call                    specialized reader with same job_id
tool/result                  output marker + exit_code
assistant/message            Agent reacts to completion
turn/end
```

Do not infer causality only from the Web trajectory row layout. The UI groups
messages by the turn that consumed them, so pending context can be drawn beside
a turn even when a later message was the actual wake source. The session event
sequence is authoritative.

## 20. Common mistakes

### Direct inbox append when immediate handling is required

```ts
owner.inbox.append('next-step', notice)
```

This stores the message but does not wake an idle Agent. Use `steer` when the
model must react without another user message.

### Using `inject` and expecting a wake

`inject` is `next-step` plus `wakeup: false`. It is correct only when waiting
for a future natural step is intentional.

### Always using `followup`

`followup` creates ordinary `next-turn` work. It can be correct for an
independent result such as continuable-subagent settlement, but a command
completion is usually context for existing work and fits `steer` better.

### Settling the job before output quiescence

This creates a completed job whose reader may still be missing final bytes.
Join the backend's output boundary before resolving the Jobs `done` promise.

### Letting both Jobs and the specialized reader own output

This duplicates bytes, cursor semantics, and model context. Choose one output
owner.

### Not waiting for an active reader before notifying

The exit callback can race with `write_stdin`. Wait for the active operation
and inspect `terminalReportedByTool` before steering.

### Treating termination during disposal as natural completion

Set owner/service closing state before terminating backends, and consult it at
the shared notification boundary.

### Removing the record immediately on exit

Unread output belongs to the caller. Release the heavy record only after the
terminal result has been constructed and its cursor advanced.

## 21. Completion checklist

- [ ] The tool finishes inline when it exits within `yield_time_ms`.
- [ ] Promotion adopts the existing operation rather than restarting it.
- [ ] One opaque `job_id` is used by every public operation.
- [ ] `ctx.jobs` owns lifecycle and cancellation.
- [ ] Exactly one component owns output collection.
- [ ] Generic and specialized completion notices cannot both reach the model.
- [ ] A true background completion steers exactly once.
- [ ] Completion returned by an active tool call suppresses steering.
- [ ] Job cancellation suppresses natural-completion steering.
- [ ] Owner and service teardown suppress steering.
- [ ] Notification failure cannot delete unread output.
- [ ] Terminal output remains readable after process exit.
- [ ] Repeated empty collection is explicit and idempotent.
- [ ] Automated tests cover foreground, background, reader race, kill, and teardown.
- [ ] A live event-order test proves idle wake without user input.

## Reference flow

```text
exec_command(cmd, yield_time_ms)
    |
    +-- start backend
    +-- subscribe bounded output log
    +-- wait for output/exit/yield
    |
    +-- exited?
    |     +-- mark terminalReportedByTool
    |     +-- return output + exit_code
    |
    +-- still live
          +-- ctx.jobs.start(...)
          +-- save registry-issued job_id
          +-- return job_id
                     |
                     v
                 backend exit
                     |
                     +-- wait output quiescence
                     +-- snapshot active reader
                     +-- claim generic Jobs notice
                     +-- settle job
                     +-- await active reader
                     |
                     +-- tool already returned exit? -> stop
                     +-- job killed?                -> stop
                     +-- owner/service closing?     -> stop
                     +-- already notified?          -> stop
                     |
                     +-- owner.steer(compact notice)
                                   |
                                   v
                              write_stdin(job_id, "")
                                   |
                                   +-- unread output
                                   +-- exit_code
                                   +-- release heavy record
                                   +-- retain lightweight completion status
```

## Sources

- [Agent inbox implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/agent/src/inbox.ts)
- [Agent scheduling methods](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/agent-loop/src/agent.ts)
- [Jobs tool completion delivery](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/jobs/tool-jobs/src/index.ts)
- [Continuable subagent settlement delivery](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/subagent/subagent/src/continuation.ts)
- [Codex Shell implementation](https://github.com/Ephemeral-AI-Lab/dsh-plugins/tree/main/codex-terminal)
