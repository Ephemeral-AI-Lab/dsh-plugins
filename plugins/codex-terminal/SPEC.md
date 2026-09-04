# dsh-codex-terminal

Status: Authoritative tool and lifecycle specification

This file defines the complete `exec_command` and `write_stdin` contract,
including pipe transport, output pagination, background-job promotion,
notification-inbox delivery, ownership, cancellation, and cleanup. README.md is
usage guidance; this file is the source of truth when the two differ.

## 1. Purpose

dsh-codex-terminal is a DeepSeek Harness plugin that exposes two Codex-style model tools:

- exec_command: start a shell command and collect its initial output.
- write_stdin: send input to, or poll, a previously started command session.

The implementation is TypeScript-first and structured so that the process backend supports Windows, macOS, and Linux without changing the model-facing tool contract.

The plugin is intentionally independent of DHS's current terminal-bash PTY path. The default runtime uses an internal pipe backend so ordinary commands and persistent stdin are fast on Windows, macOS, and Linux. A PTY implementation remains behind the backend boundary for lower-level compatibility and focused backend tests.

## 2. Goals

### Required goals

1. Provide Codex-compatible exec_command and write_stdin names and lifecycle semantics.
2. Use TypeScript and publish a normal ESM DHS plugin package.
3. Run on Windows first, with a backend boundary for macOS and Linux.
4. Use regular pipes by default for command execution and interactive stdin.
5. Preserve long-running processes between tool calls.
6. Prevent sessions from being accessed by another agent owner.
7. Bound output memory and report truncation instead of silently losing output.
8. Clean up all live processes when the plugin, owner, or DHS context is disposed.
9. Keep shell selection and security policy out of the model-visible schema.
10. Keep process output bounded in memory and avoid a disk-backed shell log by default.
11. Preserve unread terminal output after natural process exit until the terminal result is delivered.
12. Notify the owning agent when a session returned by exec_command exits naturally.
13. Automatically register every session that outlives yield_time_ms with ctx.jobs.
14. Keep job lifecycle and cancellation in ctx.jobs while write_stdin remains the only output path.

### Non-goals for v1

1. Reimplement the full Codex approval or sandbox protocol.
2. Expose terminal_open, terminal_send, or the other DHS terminal tools.
3. Add a public resize or terminate tool.
4. Guarantee that a command written for PowerShell is portable to POSIX shells, or vice versa.
5. Modify the DeepSeek Harness core packages.

## 3. Public tool contract

### 3.1 exec_command

The model-visible parameters are:

~~~ts
interface ExecCommandArgs {
  cmd: string
  workdir?: string
  yield_time_ms?: number
  max_output_tokens?: number
}
~~~

cmd is required. The following are deliberately not model-visible:

- shell
- login
- sandbox_permissions
- justification
- prefix_rule
- tty
- run_in_background

Pipes are the default transport in v1. The model-facing contract does not expose a transport switch; the plugin runtime does not allocate a PTY for ordinary commands.

Defaults:

| Setting | Default |
| --- | ---: |
| yield_time_ms | 10_000 |
| max_output_tokens | configured page size, normally 4_000 |
| hard maximum page size | configured limit, normally 10_000 |
| PTY rows | 24 |
| PTY columns | 80 |

The command runs in a new process session. A persistent shell is not reused between separate exec_command calls. If the process is still live when yield_time_ms expires, the existing session is registered as a background job and exec_command returns its single `codex-terminal-N` identifier. No separate background-mode parameter exists.

### 3.2 write_stdin

The model-visible parameters are:

~~~ts
interface WriteStdinArgs {
  job_id: string
  chars?: string
  yield_time_ms?: number
  max_output_tokens?: number
}
~~~

Defaults and behavior:

- chars defaults to an empty string.
- Empty chars means poll; it does not write an empty payload.
- Non-empty chars is written as UTF-8 data to the session's stdin pipe.
- yield_time_ms defaults to 250 for an interactive write.
- Polls must use a bounded wait and wake on output or process exit.
- Control-C, represented by U+0003, uses the backend interrupt operation for pipe sessions.
- Output already produced between exec_command and write_stdin is included in the next poll.
- An empty poll reads buffered output immediately; it must not wait merely because the output
  arrived before the poll started.
- A completed session remains readable through an empty poll. A non-empty write after exit
  returns a structured stdin-closed error without deleting the session or its unread output.
- The first successful terminal poll returns the remaining output and exit_code, then releases
  the process and output record. A lightweight owner-scoped completion record keeps later empty
  polls idempotent while the owner and its background-job history remain alive.
- An unknown, expired, or explicitly discarded session returns a structured error that identifies
  the reason; it must not be reported as an indistinguishable generic unknown session.

The implementation must serialize writes and polls for an individual session. Different sessions may be serviced concurrently.

### 3.3 Result shape

Both tools return the same canonical JSON shape:

~~~ts
interface ExecCommandResult {
  output: string
  wall_time_seconds: number
  job_id?: string
  exit_code?: number
  chunk_id?: string
  original_token_count?: number
  truncated?: boolean
  already_collected?: boolean
}
~~~

Rules:

- output is always present and may be empty.
- job_id is present while the process is running or while an exited session still has
  unread output after a token-capped result.
- job_id is the registry-issued `codex-terminal-N` identifier shared by write_stdin,
  job_list, and job_kill.
- exit_code is present once the process has exited.
- job_id and exit_code may both be present while a completed session's output is being
  paginated. The session is removed only when the terminal result has no unread output left.
- wall_time_seconds measures the current tool operation, not the full lifetime of a session.
- chunk_id is optional and may identify an output segment.
- original_token_count is emitted only when an exact token counter is available.
- truncated must be true when returned output is incomplete because of a configured limit.
- already_collected is true only for an idempotent empty poll after the promoted session's
  terminal output and exit status were already delivered.
- Each result contains the unread output delta since the previous successful result for that
  session. It includes output that arrived while no tool call was active and output that arrives
  while the current write_stdin operation is waiting.
- Model-visible output strips ANSI/VT terminal control sequences, including CSI
  and terminal-title controls, while preserving printable text, line endings,
  Unicode, and interactive PTY input behavior.

### 3.4 Output-page contract

`max_output_tokens` limits one `exec_command` or `write_stdin` response page,
not the process's total output. The effective page limit is:

~~~text
min(requested max_output_tokens ?? defaultMaxOutputTokens, maxOutputTokens)
~~~

With the suggested defaults, omission returns at most a 4_000-unit page, a
smaller positive request is honored, and any request above 10_000 is clamped to
10_000. When a page fills, the result reports truncation, retains the unread
bytes, and returns `job_id`; an empty `write_stdin` poll retrieves the next page.

The unit is an estimate of four UTF-8 bytes, not an exact model token. Therefore
4_000 units is approximately 16 KB and 10_000 units is approximately 40 KB.
The estimate is usually closest for English prose. Chinese and Japanese
characters commonly occupy three UTF-8 bytes and tokenize differently, so their
actual model-token counts can be higher or lower. Code, paths, JSON, emoji, and
mixed-language output also vary. The terminal tool deliberately avoids a
model-specific tokenizer; callers should request smaller pages for dense CJK or
otherwise token-heavy output.

### 3.5 End-to-end lifecycle

| Event | Tool/job behavior | Owner inbox behavior |
| --- | --- | --- |
| Command exits within `yield_time_ms` | `exec_command` returns output and `exit_code`; no job is created. | No notice. |
| Command remains live after `yield_time_ms` | The session is promoted to `ctx.jobs`; `exec_command` returns the registry-issued `job_id`. | No notice while still running. |
| Caller polls or writes while live | `write_stdin` returns unread output and keeps the same `job_id`. | No separate notice. |
| Active `write_stdin` observes exit | That call returns the terminal output and `exit_code`. | Completion notice is suppressed to avoid duplicate delivery. |
| Background command exits between calls | Output remains buffered for an empty `write_stdin` poll. | One compact plugin notice is steered into the owner's inbox. |
| Owner or plugin is disposed | The process tree is terminated and retained state is released. | No notice wakes a disposing owner. |

## 4. DHS integration

The plugin entry point must follow the DHS Cordis plugin shape:

~~~ts
export const name = 'codex-terminal'
export const inject = ['tools', 'systemPrompt', 'jobs']

export function apply(ctx: Context): void {
  // Register the job-aware session service and both model-facing tools.
}
~~~

The exact DHS tool registration must use defineTool() and ctx.tools.register(). Each tool must:

1. Validate its arguments through the tool schema.
2. Use exec.signal for cancellation.
3. Return one canonical JSON value.
4. Throw infrastructure failures rather than encoding them as successful output.
5. Register cleanup through the Cordis effect/disposal lifecycle.
6. Fail at load when ctx.jobs is unavailable.

The plugin may add a short system-prompt capability note describing the host shell, for example that Windows commands use PowerShell and POSIX commands use the resolved POSIX shell.

The plugin must be loadable from a compiled absolute module path in a Cordis configuration entry:

~~~yaml
- insert:
    - id: codex-terminal
      name: '/absolute/path/to/dsh-plugins/codex-terminal/lib/index.js'
~~~

## 5. Package layout

~~~text
dsh-codex-terminal/
├── package.json
├── tsconfig.json
├── README.md
├── SPEC.md
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── tools/
│   │   ├── exec-command.ts
│   │   └── write-stdin.ts
│   ├── session/
│   │   ├── exec-session-service.ts
│   │   ├── session-registry.ts
│   │   ├── output-log.ts
│   │   └── lifecycle.ts
│   ├── backend/
│   │   ├── session-backend.ts
│   │   ├── pty-backend.ts
│   │   ├── pipe-backend.ts
│   │   └── node-pty-backend.ts
│   ├── shell/
│   │   ├── shell-adapter.ts
│   │   ├── windows-powershell.ts
│   │   └── posix-shell.ts
│   ├── output/
│   │   ├── output-limiter.ts
│   │   └── text-decoder.ts
│   └── policy/
│       └── execution-policy.ts
└── test/
    ├── tools.test.ts
    ├── session-lifecycle.test.ts
    ├── output.test.ts
    ├── windows.integration.test.ts
    └── cross-platform.integration.test.ts
~~~

Platform-specific behavior must stay in backend/ and shell/. Tool files must not contain process.platform branches or direct child_process/PTY calls.

## 6. Session service

The session service is the central internal API used by both tools:

~~~ts
interface ExecSessionService {
  exec(request: ExecRequest): Promise<ExecResult>
  write(request: WriteRequest): Promise<ExecResult>
  closeOwner(owner: SessionOwner): Promise<void>
  dispose(): Promise<void>
}
~~~

Each session record must contain:

~~~ts
interface SessionRecord {
  id: number
  owner: SessionOwner
  backend: SessionBackend
  output: OutputLog
  state: 'starting' | 'running' | 'exited' | 'terminating' | 'closed'
  activeOperation?: Promise<unknown>
  exit?: ExitStatus
  startedAt: number
  outputDelivered: boolean
  completionNotified: boolean
  jobId?: string
  jobCancelRequested: boolean
  exitObservedAt?: number
  cleanupReason?: 'collected' | 'owner_disposed' | 'service_disposed' | 'expired' | 'backend_failure'
}
~~~

Session rules:

1. Reserve the numeric ID before spawning.
2. Publish the record only after backend setup succeeds.
3. Roll back the record if spawning fails.
4. Validate owner identity on every write operation.
5. Serialize operations for one session.
6. Keep an exited session and its unread output available until a successful terminal poll,
   explicit lifecycle cleanup, or an explicitly configured expiry.
7. Terminate all live sessions during plugin disposal.
8. Limit active sessions through configuration; the default target is 64.
9. Do not silently evict an exited session whose terminal result has not been delivered. If the
   retention budget is full, reject a new exec_command with an explicit capacity error.
10. Remove all backend listeners, timers, process references, and registry references exactly once
    during finalization. Cleanup must be idempotent and must not depend on JavaScript garbage
    collection running at a particular time.
11. Keep only lightweight completion metadata after a promoted session's terminal output has
    been collected; repeated empty polls return the same exit status without retaining the process
    or output buffer.

### 6.1 Session lifecycle and retention

The lifecycle has two independent milestones:

1. Process exit: the root process has exited and stdin is closed.
2. Output closure: stdout/stderr have been drained and the output log has been finalized.

The service must not treat process exit alone as permission to discard output. A session may be
in `state: 'exited'` while it is still holding unread output for a later empty write_stdin poll.

For the initial exec_command operation:

- If the process exits before the initial result is returned, return the terminal output and
  exit_code directly and do not return a job_id.
- If the initial operation returns a job_id, retain that session even if the process exits
  immediately afterward.

For a later natural exit:

- Drain stdout/stderr before marking the output log complete.
- Retain the record until the first successful terminal poll returns the unread output and
  exit_code.
- Remove the record only after the result has been constructed and the output cursor advanced.
- Preserve a lightweight completion record for promoted sessions so a delayed notification cannot
  turn a harmless second empty poll into an unknown-session error.

There is no implicit process-session disk persistence in v1. A job_id is valid only while its
owning ExecSessionService is alive. Plugin disposal, owner disposal, or process failure may make a
session unavailable, but each such removal must have an explicit cleanup reason and diagnostic
path. Restart recovery is a separate, opt-in feature and must not be simulated by writing full
shell output into the main DSH conversation log.

### 6.2 Background-job promotion

If the process is still live when the initial yield expires, the session service registers one
`codex-terminal` job through ctx.jobs. The registry-issued job ID is also the write_stdin target.
The job's cancel hook terminates the same backend and its done
promise settles only after process exit and output quiescence.

ctx.jobs owns the job ID, running/stopping/terminal state, owner fencing, job_list visibility, and
job_kill. It does not own terminal output: the producer supplies no readOutput hook or outcome
output. Before settling the job, Codex Shell attaches a terminal wait so the generic job_output
completion notice is marked reported; it then sends its own write_stdin instruction without
advancing the session output cursor.

Commands that exit before the initial result are returned inline and never registered. A process
that exits at the yield boundary either returns inline or becomes an already-terminal registered
job; it must not escape both paths.

### 6.3 Natural-exit notification and inbox delivery

When exec_command has already returned a live job_id and the process later exits naturally,
the service emits at most one owner-scoped completion notification. The notification is not a
second tool/result and must not fabricate a historical tool call.

The notification is emitted only for background completion between tool calls. If an active
write_stdin operation observes the exit and returns exit_code inside its yield, that tool result
is the terminal delivery and the completion steer is suppressed. The service waits for the operation
that was active at exit before deciding, so input that causes the process to terminate cannot
produce both a terminal tool result and a completion notice.

The notification is compact and instructs the agent to retrieve the result:

~~~text
exec job codex-terminal-12 exited with code 0.
Call write_stdin with job_id="codex-terminal-12" and chars="" to collect the remaining output.
~~~

The notification must not contain the full output. The full unread output remains available from
write_stdin, which is the single terminal-result path. A promoted session delivers the notice with
`owner.steer(notification)`. A running owner consumes it at the nearest later step boundary; an
idle owner wakes in a new turn so the model learns that the job finished. The owner interface does
not expose `followup`, and Codex Shell never uses it for completion delivery.

The steered value is a user-role plugin notice with `source.kind: 'plugin'`,
`source.plugin: 'codex-terminal'`, and `source.form: 'notice'`. DSH places that
notice in the owning agent's inbox. It is session-local and owner-fenced: it is
not broadcast to other agents, inserted as a fabricated tool result, or copied
into generic `job_output`. The notice contains only the job ID, exit code, and
the instruction to poll `write_stdin` with empty `chars`.

The notification is sent only after output closure is complete and only once. Owner or service
teardown suppresses it rather than waking an agent being disposed. If notification delivery fails,
the session remains pollable; notification failure must never delete output.

The public job ID is an opaque plugin identifier. It must not be treated as an operating-system PID, even if the backend also exposes a PID internally.

## 7. Backend abstraction

The session service must depend on this platform-neutral interface:

~~~ts
interface SessionBackend {
  readonly transport: 'pty' | 'pipe'
  readonly pid?: number
  write(data: Uint8Array): Promise<void>
  closeStdin(): Promise<void>
  interrupt(): Promise<void>
  terminate(): Promise<void>
  waitForExit(): Promise<ExitStatus>
  waitForQuiescence(): Promise<void>
}
~~~

### PTY backend (optional)

The PTY backend is retained as an isolated backend:

- Windows: ConPTY through the selected PTY library.
- macOS/Linux: native POSIX PTY through the same adapter.
- PTY output is a single merged stream.
- Default size is 80 columns by 24 rows.
- It is not selected by the plugin's default runtime path.

### Pipe backend (primary)

The pipe backend is the runtime backend:

- Use child_process.spawn() with explicit argv.
- Do not use Node exec() or implicit shell interpolation.
- Keep stdout and stderr separately until the result renderer combines them.
- Support delayed stdin writes.
- Use bounded output collection.

The fallback policy must be explicit in configuration:

~~~ts
type PtyFallback = 'pipe' | 'error'
~~~

## 8. Shell adapter

The shell adapter is responsible for resolving an executable and constructing arguments. Shell configuration is plugin configuration, not model input.

~~~ts
interface ShellAdapter {
  resolve(): Promise<ResolvedShell>
  oneShotArgs(command: string): readonly string[]
  interactiveArgs(): readonly string[]
}
~~~

Recommended resolution:

### Windows

1. Configured executable.
2. pwsh.exe.
3. Windows PowerShell 5.1.
4. cmd.exe only as an explicit compatibility fallback.

### macOS/Linux

1. Configured executable.
2. SHELL.
3. /bin/zsh on macOS.
4. /bin/bash.
5. /bin/sh.

The adapter must pass the command as one shell-specific argument and must not concatenate untrusted arguments into a command line.

## 9. Output handling

Each session owns an append-only output log. Reads are cursor-based internally and are non-consuming from the backend.

~~~ts
interface OutputLog {
  append(stream: OutputStream, bytes: Uint8Array): void
  read(cursor: number, limit: OutputLimit): OutputRead
  waitForChange(cursor: number, signal: AbortSignal): Promise<void>
}
~~~

Requirements:

- Decode bytes with a streaming TextDecoder.
- Preserve output across multiple polls.
- Return explicit truncation metadata.
- Enforce a hard byte ceiling in addition to max_output_tokens.
- Drain output after root process exit before finalizing the log. Prefer stream-close/output-change
  events over unconditional sleeping; a bounded trailing-output grace period may be used only as
  a safety fallback.
- Distinguish root exit, process-tree termination, and output drain completion.
- Maintain an unread cursor per session. A poll must first return already-buffered unread output,
  then wait only if the cursor is at the current end of the log.
- If max_output_tokens limits one result, advance the cursor only through the returned bytes.
  The next poll must return the remaining buffered bytes immediately.
- Output arriving between exec_command and the next write_stdin is recorded by the session's
  data handlers even when no tool operation is active. The next poll reads that data from the
  unread cursor; it is not lost merely because it arrived between calls.
- Output arriving while write_stdin is waiting is appended before the operation completes and is
  included in that operation's result.
- The pre-publication backend queue and the OutputLog together must obey the configured aggregate
  output budget. A fast producer must not bypass the memory limit before the session is published.

The initial implementation uses a bounded in-memory head/tail buffer. A spill-to-disk
implementation is not required for v1 and must not be enabled implicitly. If a future durable
spool is added, it must have independent byte and age quotas, explicit cleanup, and a shutdown
flush barrier; it must not duplicate every terminal chunk into the DSH conversation log.

## 10. Cancellation and termination

Cancellation from exec.signal must stop a pending tool operation and terminate the associated process session when appropriate.

The backend must distinguish:

- closeStdin(): send EOF only.
- interrupt(): request foreground interruption, normally Control-C.
- terminate(): terminate the complete process tree.

Windows v1 may use taskkill /PID <pid> /T /F as the process-tree fallback. The backend interface must leave room for a stronger Windows Job Object implementation later. POSIX implementations should use detached process groups and group-level termination.

Termination must be idempotent and safe when the process has already exited. Process-tree cleanup
must have a bounded timeout. If a backend does not acknowledge termination in time, release all
JS-side listeners/timers/registry references, record a cleanup failure, and surface that reason;
never leave a permanently retained `terminating` record waiting for an unbounded promise.

## 11. Security policy

Approval and sandbox parameters must not be accepted from the model.

The plugin must instead use a deployment-level execution policy:

~~~ts
type ExecutionMode = 'trusted' | 'host-policy'
~~~

- trusted: intended for local development and explicitly trusted profiles.
- host-policy: delegates command confinement to a DHS-compatible policy adapter.

The default production configuration should require an explicit policy choice rather than silently granting broad host access.

The policy boundary must be independent of the tool schemas so that security behavior can change without changing the model contract.

## 12. Configuration

All operational limits belong in plugin configuration rather than hidden constants:

~~~ts
interface Config {
  executionMode: 'trusted' | 'host-policy'
  ptyFallback: 'pipe' | 'error'
  maxSessions: number
  defaultYieldTimeMs: number
  pollYieldTimeMs: number
  maxOutputBytes: number
  defaultMaxOutputTokens: number
  maxOutputTokens: number
  maxRetainedOutputBytes: number
  terminationTimeoutMs: number
  completedSessionTtlMs?: number
  rows: number
  cols: number
  windowsPtyStartupGraceMs?: number
  windowsShell?: string
  posixShell?: string
}
~~~

Suggested development defaults:

~~~ts
{
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 64,
  defaultYieldTimeMs: 10_000,
  pollYieldTimeMs: 250,
  maxOutputBytes: 1_048_576,
  defaultMaxOutputTokens: 4_000,
  maxOutputTokens: 10_000,
  maxRetainedOutputBytes: 67_108_864,
  terminationTimeoutMs: 5_000,
  // 0 or omitted means no automatic expiry in v1. If enabled later, expiry must
  // produce an explicit tombstone/error rather than an unknown-session result.
  completedSessionTtlMs: 0,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000
}
~~~

## 13. Testing requirements

### Unit tests

- Tool schemas expose only the approved public parameters.
- Missing cmd and missing job_id are rejected.
- Empty chars performs a poll.
- Job IDs are unique within an owner.
- A different owner cannot write to a session.
- Concurrent operations on one session are serialized.
- Output truncation is reported.
- Omitted page size uses defaultMaxOutputTokens; larger requests are clamped to maxOutputTokens.
- Four-byte page accounting is deterministic for English, CJK, and mixed UTF-8 output.
- Output produced between exec_command and write_stdin is returned by the next poll.
- A poll with existing unread output returns immediately rather than waiting for new output.
- Output remaining after max_output_tokens is returned by the next poll.
- Natural process exit retains output until an empty write_stdin returns the terminal result.
- A non-empty write after natural exit cannot delete the session; an empty poll still succeeds.
- Exit is not finalized until stdout/stderr drain is complete.
- Completion notification is sent once and does not contain duplicate full output.
- Notification failure does not affect session pollability.
- Aggregate output and pre-publication buffers stay within the configured memory budget.
- Cancellation is propagated.
- Disposal terminates all live sessions and releases listeners, timers, and registry references.
- Cleanup timeout produces an explicit diagnostic rather than a permanently retained session.

### Windows integration tests

- Run a short PowerShell command and return exit_code.
- Run a long-lived Node or PowerShell process and return job_id.
- Send input through write_stdin.
- Poll with empty chars.
- Interrupt a live pipe process.
- Use a custom workdir.
- Preserve Unicode output.
- Verify ordinary commands and stdin use pipes without PTY startup delay.
- Verify process-tree cleanup after termination.
- Verify a completed-but-unpolled session is retained until its terminal poll.
- Verify capacity pressure rejects new sessions instead of silently evicting unread output.

Tests should use Node-based fixtures where possible so they are not coupled to Unix commands such as ls, bash, or sleep.

### DHS integration test

Load the compiled plugin in a minimal DHS profile and verify:

1. Both tools appear in the tool schema list.
2. exec_command can be called by an agent.
3. A live job can be polled with write_stdin using the job ID returned by exec_command.
4. Plugin disposal leaves no live child process.

## 14. Definition of done

The first implementation is complete when:

1. dsh-codex-terminal builds from TypeScript to lib/.
2. DHS can load the compiled plugin through an absolute Cordis entry.
3. Windows supports the complete exec_command to write_stdin lifecycle.
4. Pipe transport is the default and supports the complete exec_command to write_stdin lifecycle.
5. Session ownership, output limits, cancellation, and cleanup are tested.
6. macOS/Linux backend boundaries compile cleanly, even if their integration tests run later.
7. No model-visible parameter implements shell selection or approval bypass.
8. Natural exits are observable through a compact owner notification and remain pollable through
   write_stdin until the terminal result is delivered.
9. Memory cleanup is bounded and reasoned: no unbounded output queue, no unbounded termination
   wait, no duplicate durable shell transcript, and no silent session deletion.
