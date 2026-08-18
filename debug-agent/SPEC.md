# DSH debug-agent implementation specification

Status: proposed v1. The rules in this document are normative. `MUST` and
`MUST NOT` are requirements; `SHOULD` and `SHOULD NOT` are defaults that may
be changed only with an explicit compatibility decision.

This plugin is an external Cordis plugin for DeepSeek Harness (DSH). Its
purpose is deterministic execution of one debug command or a replay script
through the real DSH agent loop and tool runtime.

The implementation lives at:

```text
C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\debug-agent
```

No implementation step covered by this specification may modify the
`deepseek-harness` source tree.

## 1. Fixed architecture

The plugin MUST use the public `@deepseek-ai/dsh-llm` `LlmAdapter` contract and
the public Cordis plugin contract. It MUST register the provider route
`mock-debug` and the model id `debug`:

```text
per-turn /debug command
        |
        v
debug command/replay controller
        |
        v
public DSH per-turn model selection: { provider: "mock-debug", model: "debug" }
        |
        v
MockDebugAdapter (public @deepseek-ai/dsh-llm LlmAdapter)
        |
        v
real DSH AgentLoop
        |
        v
real DSH ToolRuntime -> registered tool
```

The adapter emits model output only. It MUST NOT invoke a tool implementation,
replace `ctx.llm`, replace `AgentLoop`, replace `ToolRuntime`, or install a
second tool-validation or policy engine. In particular, it MUST NOT call a
tool's `execute` function directly.

The plugin is a command surface, not a model-page selection feature. The DSH
model page MUST NOT be required to select `mock-debug/debug`, and the plugin
MUST NOT permanently change an agent's configured provider or model. A command
selects the debug route for that turn only. The route may be discoverable to
the host's provider APIs for plumbing and tests, but it is not the user-facing
control surface.

The command layer MUST use the host's public command and per-turn generation
hooks. It MUST NOT call the adapter to manufacture a separate conversation or
run a private agent loop. If a supported DSH version does not expose a public
per-turn model override, that integration gap MUST be reported rather than
solved by mutating the session model or replacing the loop.

## 2. Provider and plugin contract

The Cordis entry point MUST have the normal external-plugin shape, using the
exact public typings of the supported DSH version:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { MockDebugAdapter } from './mock-adapter.js'

export const name = 'debug-agent'
export const inject = ['llm']

export function apply(ctx: Context): void {
  const adapter = new MockDebugAdapter()
  const registration = ctx.llm.registerAdapter(['mock-debug'], adapter)
  ctx.effect(() => {
    adapter.dispose()
    return registration
  }, 'debug-agent cleanup')
}
```

The exact cleanup shape may follow the installed Cordis version, but disposal
MUST unregister `mock-debug`, abort or release adapter-owned state, remove
command/UI/event subscriptions, and remove all session plans. The package
MUST depend only on public DSH/Cordis packages at runtime, with DSH packages
supplied by the host as peer dependencies where appropriate.

The adapter MUST expose provider metadata for `mock-debug` and model metadata
for `debug`, for example:

```text
providerInfo("mock-debug") -> { id: "mock-debug", name: "Mock Debug" }
resolve/list model("mock-debug", "debug")
  -> { provider: "mock-debug", id: "debug", name: "Deterministic Debug Model" }
```

Metadata availability MUST NOT cause the plugin to switch the persistent
model-page selection.

## 3. Slash-command control surface

The plugin MUST register `/debug` through the public DSH slash-command/message
command surface. A slash command received as a normal message, followup, or
steer command MUST be parsed the same way and scheduled as the next debug
turn. Followup and steer do not create a special execution mode.

Every accepted debug command creates a turn-local plan keyed by the current
DSH `sessionId` and a unique debug turn id. The command dispatcher MUST hand
that plan to the normal AgentLoop through the public per-turn route override:

```text
{ provider: "mock-debug", model: "debug", debugTurnId: "..." }
```

No global `debugEnabled` flag may affect later turns. After a debug turn is
complete, a non-slash message MUST use the real provider configured for that
turn. Debug and real-provider turns MAY coexist in one session transcript and
MUST remain distinguishable by their per-turn route and durable events.

### 3.1 `/debug run`

`/debug run` MUST accept exactly one executable unit: either one tool call or
one parallel group. Tool arguments MUST be JSON objects. The command grammar
is:

```text
/debug run tool_name(JSON_OBJECT)
/debug run [tool_name(JSON_OBJECT) tool_name(JSON_OBJECT) ...]
```

Examples:

```text
/debug run probe_tool({"value":"ok"})
/debug run exec_command({"cmd":"Get-Location"})
/debug run [probe_a({"value":"a"}) probe_b({})]
```

The bracket form MUST contain one or more complete tool-call expressions. The
command parser MUST reject JavaScript syntax,
single-quoted or unquoted object literals, comments, trailing statements,
multiple sequential calls, and malformed JSON.

`/debug run` MUST NOT accept wait syntax. In particular, `--wait`, `wait`, a
wait object, a semicolon-separated second command, or a second top-level call
MUST produce a command error and no tool call. A wait can be authored only in a
canonical replay script.

The command parser validates command shape and JSON syntax only. Unknown-tool
and tool-schema validation MUST be delegated to the real DSH tool runtime.

### 3.2 `/debug replay`

The replay grammar is:

```text
/debug replay <path>
/debug replay <path> --overwrite-wait-time-ms <N>
```

There MUST be exactly one path and, if present, one non-negative integer `N`.
The input adapter is selected from the file content or a documented format
detector. v1 MUST support canonical debug-script JSON and DSH JSONL. Additional
formats MAY be registered later, but each adapter MUST output canonical JSON
before validation and execution.

`--overwrite-wait-time-ms N` is a timing override, not a file overwrite flag.
It MUST replace explicit wait values in the in-memory canonical plan only. It
MUST NOT replace, modify, rename, copy, or delete the input file.

## 4. Canonical debug-script format

All command and replay inputs MUST normalize to this versioned JSON shape:

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "ok" } },
    {
      "parallel": [
        { "tool": "probe_a", "args": {} },
        { "tool": "probe_b", "args": { "value": 2 } }
      ]
    },
    { "wait": 250 },
    { "tool": "probe_c", "args": {} }
  ]
}
```

The canonical grammar is:

```text
Script       = { type: "dsh-debug-script", version: 1, steps: Step[] }
ToolStep     = { tool: ToolName, args: JsonObject }
ParallelStep = { parallel: NonEmptyArray<ToolStep> }
WaitStep     = { wait: NonNegativeInteger }
Step         = ToolStep | ParallelStep | WaitStep
```

Unknown top-level or step properties MUST be rejected. Tool names MUST obey the
public DSH tool-name rules. JSON arguments MUST remain data; the validator MUST
never evaluate them as code.

`WaitStep` is a scheduling step, not a tool call. A wait MUST occur only
strictly between two top-level executable steps. It MUST NOT be the first or
last step, MUST NOT be consecutive with another wait, and MUST NOT occur
inside a `parallel` array. A parallel group contains tool steps only. Every
tool inside one group is one sibling response from the adapter and is eligible
for the normal DSH parallel tool execution behavior.

The following script has three executable steps, not five:

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "a", "args": {} },
    { "wait": 1000 },
    { "parallel": [
      { "tool": "b", "args": {} },
      { "tool": "c", "args": {} }
    ] },
    { "wait": 500 },
    { "tool": "d", "args": {} }
  ]
}
```

The unified canonical validator MUST be the same validator for self-authored
JSON and every converted input format. Format adapters MUST not duplicate
canonical validation rules.

## 5. Timing semantics

Execution is ordered by top-level executable steps. A parallel group is one
step; its members have no plugin-owned inter-member wait. A wait belongs to the
edge between the preceding and following top-level executable steps.

When no explicit wait exists on an edge, the runner MUST use a default gap of
100 ms. An explicit `wait` MUST be preserved by default. When
`--overwrite-wait-time-ms N` is supplied, it MUST replace explicit wait values
only; edges that had no explicit wait MUST continue to use the 100 ms default.
Thus, the option does not turn every gap into `N`.

The effective schedule is:

```text
E1 -- explicit wait, or 100 ms if absent --> E2
E2 -- explicit wait, or 100 ms if absent --> E3
```

The runner MUST implement waits as cancellation-aware delays in the adapter's
next-response path after the preceding tool result(s) have arrived. It MUST
not execute a local copy of the tool loop. A wait MUST not emit a tool-call
chunk, a fake tool result, or a progress step. A cancelled wait MUST settle by
the normal DSH cancellation path.

If a converter derives timing from source timestamps, it MUST convert only
timestamps with known comparable units and a reliable top-level step boundary.
The resulting non-negative integer gap MUST be represented as an explicit
`wait` step. Missing, incomparable, or ambiguous timestamps MUST not be
turned into guessed waits; normal 100 ms defaults apply instead. Timestamp
preservation is playback pacing and is not a promise to reproduce historical
tool durations.

## 6. Input adapters and DSH JSONL conversion

An input adapter has one responsibility: parse its source and return canonical
`dsh-debug-script` JSON plus source locations for diagnostics. It MUST NOT
execute tools, emit model chunks, or bypass the unified validator.

The DSH JSONL adapter MUST implement these rules:

1. Tool-call blocks that are siblings in one `assistant/message` are one
   `parallel` step. Their order in the array MUST be retained within the group.
2. Distinct DSH agent steps MUST become distinct sequential top-level steps,
   ordered by the source step sequence or equivalent durable ordering.
3. Interleaved `tool/call` and `tool/result` records MUST not convert siblings
   from one assistant step into sequential steps.
4. Call name and JSON arguments MUST be copied into `tool` and `args`.
5. Historical tool results, tool-result content, approval outcomes, and prior
   tool output MUST NOT be replayed as input or synthesized as new results.
   Replay executes fresh calls through the current DSH runtime.
6. Call ids MAY be used for source diagnostics but MUST NOT be reused as live
   call ids; the adapter generates new ids when it emits model output.
7. When reliable comparable step timestamps exist, the adapter MAY insert
   explicit waits according to section 5. It MUST report a conversion error
   instead of silently choosing between conflicting timestamp boundaries.

The adapter MUST report a `CONVERSION_MISMATCH` error when records that claim
to describe the same assistant step disagree about tool name, call identity,
or arguments. It MUST include the input path (when known), line/record
locations, and the conflicting fields. It MUST NOT silently prefer one record
kind merely because it is easier to parse. A malformed JSONL record,
incomplete tool-call, non-object arguments, invalid tool name, unsupported
script version, or illegal wait placement is an invalid script/conversion
error before execution.

Other input format adapters MUST obey the same contract. Their output MUST be
canonical JSON and their mismatch diagnostics MUST be surfaced rather than
hidden behind a generic parse failure.

## 7. Replay execution inside the real AgentLoop

The adapter is a deterministic model, not a replay executor. For each
executable plan step, its `stream()` method MUST emit ordinary DSH assistant
tool-call chunks. The AgentLoop then persists the assistant message and uses
the real ToolRuntime to resolve, validate, authorize, cancel, execute, render,
and persist each tool result.

For a single tool step, the adapter emits one call. For a parallel step, it
emits one assistant response containing one complete tool-call block per member
and finishes with `tool-calls`. It MUST then wait for the corresponding current
turn tool result message(s) before emitting the next scripted model response.
The adapter MUST never inspect or manufacture a result by itself.

The sequence is:

```text
stream(E1) -> complete tool-call block(s) -> finish: tool-calls
AgentLoop -> normal ToolRuntime -> durable tool/result event(s)
stream(wait edge, if any) -> next complete tool-call block(s)
AgentLoop -> normal ToolRuntime -> durable tool/result event(s)
stream(final response) -> one full text delta -> finish: stop
```

Only the final response ends the debug turn. Intermediate responses MUST end
with `finish: { kind: "tool-calls" }`; they MUST NOT end with `stop` merely
because one scripted step completed. Waits do not end a turn.

For v1 the adapter MUST emit complete tool-call blocks. It MUST NOT emit
tool-call deltas. A tool call is represented by a `block-start` followed by a
`block-end` containing the complete `tool-call` block and JSON-stringified
arguments. The final response MUST contain one complete text delta (and may
have the corresponding block start/end) followed by `finish: { kind: "stop" }`.
There is no requirement to emulate token-by-token text or tool-call deltas.

On the final successful response, the text SHOULD be a short deterministic
summary. The DSH tool-call and tool-result events remain authoritative; the
summary is presentation only. The adapter MUST honor the request
`AbortSignal` during emission and waits.

### 7.1 Fail-fast behavior

The adapter MUST preserve the real runtime's unknown-tool and invalid-argument
errors. It MUST not pre-approve or locally validate them in a way that changes
DSH behavior. When the current result reports `UNKNOWN_TOOL` or `INVALID_ARGS`,
the debug plan MUST enter a terminal failed state and no later top-level step
may be emitted. The same terminal stop SHOULD apply to policy/approval denial,
tool execution failure, invalid tool output, and other `isError` results so a
failed deterministic replay cannot silently diverge.

For a parallel group, all sibling calls already emitted in that response may
finish through the normal DSH runtime. A failure in one member MUST prevent
later top-level steps, but it cannot retroactively unsend or cancel sibling
calls unless normal DSH cancellation does so.

Background-job tools are allowed. They MUST run through the normal DSH tool
runtime, and a later scripted `write_stdin`-style call may interact with the
real job state. The plugin does not copy, virtualize, or simulate that state.
Nested or subagent tools are unsupported for deterministic replay. The replay
preflight SHOULD reject a tool marked as nested/subagent by public tool
metadata with an explicit unsupported-tool error. The plugin MUST NOT claim a
deterministic replay guarantee when the public runtime cannot classify such a
tool.

## 8. Lifecycle, isolation, events, and errors

### 8.1 Agent status

The plugin MUST use normal DSH agent status transitions. On acceptance of a
debug command, the agent becomes `running` when the normal turn starts. It
remains `running` across tool execution, waits, and intermediate scripted
responses. It becomes `idle` only after the final response, a normal terminal
error, cancellation, or disposal has settled. The plugin MUST NOT publish a
fake idle status between script steps.

### 8.2 Session isolation

All mutable plan state MUST be keyed by the DSH `sessionId` and a debug turn
id. A global pending-call or global current-script variable is forbidden.
Two sessions may replay different scripts concurrently and must not consume
each other's calls, results, waits, status, events, or cleanup. A missing
`sessionId` MUST be rejected clearly or handled as request-local state that is
destroyed before the request returns; it MUST never use a shared fallback key.

The adapter MUST associate a result with the expected call id(s) and current
plan step. A stale, duplicate, or cross-session result MUST produce a
diagnostic terminal error and MUST NOT advance the plan.

### 8.3 Cleanup

Plan state, abort listeners, wait timers, command subscriptions, UI
subscriptions, and event subscriptions MUST be released on final success,
terminal error, cancellation, session teardown, and plugin disposal. Cleanup
MUST be idempotent. A disposed plugin MUST not emit another model response or
retain references to an agent/session.

### 8.4 Durable events

The normal DSH durable events are authoritative and MUST remain intact:

- assistant messages containing the emitted tool-call blocks;
- real `tool/call` events;
- real `tool/result` events, including runtime error codes and output;
- the final assistant message.

The plugin SHOULD persist command/replay lifecycle events through the public
DSH session event/persistence API, with at least the session id, debug turn id,
source mode (`run` or `replay`), source format/path when allowed, script id,
executable-step count, and terminal status. Step events MAY include
`started`, `completed`, `failed`, `waiting`, or `cancelled`, but waits MUST NOT
be represented as tool events. Plugin-owned events MUST be serializable and
must not duplicate or replace DSH tool cards. If a supported DSH release does
not expose a public durable-event extension point, the plugin MUST retain the
normal DSH events and report that optional debug lifecycle persistence is
unavailable; it MUST NOT write a private database or edit DSH source.

Error classes presented to callers/UI MUST remain distinguishable:

| Class | Meaning | Execution effect |
| --- | --- | --- |
| `INVALID_COMMAND` | Slash grammar or JSON syntax is invalid | No tool call; no plan starts |
| `INVALID_SCRIPT` | Canonical shape, wait placement, version, or adapter output is invalid | No tool call; no plan starts |
| `CONVERSION_MISMATCH` | Source records disagree | No tool call; no plan starts |
| `UNKNOWN_TOOL` | Real DSH registry cannot resolve a requested tool | Real tool result; stop later steps |
| `INVALID_ARGS` | Real DSH schema rejects arguments | Real tool result; stop later steps |
| `UNSUPPORTED_NESTED_TOOL` | Replay cannot guarantee nested/subagent determinism | No such replay step; stop |
| runtime/policy/output error | Normal DSH tool failure or denial | Preserve normal event/error; stop the debug plan |
| cancellation | Normal DSH cancellation | Settle stream, clean up, become idle |

## 9. UI/UX contract

If the plugin contributes UI, it MUST provide a compact generic active
indicator above the composer while the current debug turn is running. It MUST
not say `Running 2 tools in parallel` or otherwise make a parallel group a
second tool-progress surface.

The UI MUST provide:

1. An invalid-script card for invalid command syntax, invalid canonical JSON,
   conversion errors, and conversion mismatches. It MUST show enough source
   location/error detail to fix the input and MUST show that no tool ran.
2. An invalid-tool stop card for an unknown tool or invalid arguments. It MUST
   show the failing tool and runtime error code, state that later steps were
   stopped, and leave the actual DSH tool card visible.
3. Script progress where the denominator counts executable top-level steps
   only. Wait steps are excluded. A parallel group counts as one step.

Actual DSH tool-call and tool-result cards are authoritative for member-level
progress, approvals, errors, and output. Plugin UI MUST not synthesize a
competing tool card or rewrite a result.

The detailed UI/UX placement, state model, progress rules, cancellation
behavior, and rendering logic are defined in [`ui/ui-ux.md`](ui/ui-ux.md).

## 10. File and replay safety policy

Replay MUST read the requested source and convert/validate it in memory. It
MUST execute the resulting canonical object directly. It MUST NOT make a
physical copy of the DSH JSONL, write a converted canonical script, create a
temporary replay file, or overwrite the source. Format adapters MUST expose
canonical JSON as their result so an explicit future conversion/export
operation can persist it; replay itself MUST remain in-memory.

The `--overwrite-wait-time-ms` option affects only explicit wait values in the
in-memory plan. It MUST never be interpreted as permission to overwrite any
file.

One policy decision remains intentionally open and MUST be resolved before
shipping path-based replay: how `<path>` is resolved and constrained. The
implementation owner MUST choose and document a host-compatible policy for
relative paths, absolute paths, current-session working directory, allowed
roots, symlinks, and path traversal. This task does not silently choose
session-cwd, plugin-directory, or unrestricted absolute-path behavior. Until
that decision is made, the reader MUST use the host's existing approved
read-only file-access policy or reject path replay with a clear error. In all
policies, source and destination overwrite behavior remains disabled unless a
future specification explicitly adds an output destination, overwrite rule,
and atomicity/permission behavior.

## 11. Implementation folder structure

The package should remain small and external. Generated `lib/` output is a
build artifact and is not hand-authored. For v1, command routing, replay
state, timing, and the compact UI status model MUST remain in the existing
source modules unless a separate module is proven necessary. The required
source set is `index.ts`, `mock-adapter.ts`, `parser.ts`, and `converter.ts`;
there MUST be no `scenario.ts`.

```text
debug-agent/
├── src/
│   ├── index.ts                 # Cordis entry point and public registration
│   ├── commands.ts              # /debug run and /debug replay parsing/routing
│   ├── mock-adapter.ts          # public LlmAdapter and scripted responses
│   ├── parser.ts                # strict command/JSON parsing primitives
│   ├── script.ts                # canonical types, validator, timing plan
│   ├── replay.ts                # in-memory replay orchestration and cleanup
│   ├── converter.ts             # input-adapter registry and DSH JSONL adapter
│   ├── events.ts                # public durable debug lifecycle events
│   └── ui.ts                    # indicator, invalid cards, and progress model
├── test/
│   ├── commands.test.ts         # slash grammar and per-turn routing
│   ├── parser.test.ts            # JSON-only parser cases
│   ├── script.test.ts            # canonical validation and wait rules
│   ├── converter.test.ts         # DSH JSONL and mismatch diagnostics
│   ├── adapter.test.ts           # complete chunk stream and session isolation
│   ├── replay.test.ts            # timing, fail-fast, no-write behavior
│   ├── integration.test.ts       # real AgentLoop and real ToolRuntime
│   ├── plugin.test.ts            # compiled external load and disposal
│   └── ui.test.ts                # cards, indicator, and step counting
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── cordis.patch.yml
├── README.md
└── spec.md
```

The normative v1 source set is only:

```text
src/index.ts
src/mock-adapter.ts
src/parser.ts
src/converter.ts
test/parser.test.ts
test/converter.test.ts
test/adapter.test.ts
test/integration.test.ts
test/plugin.test.ts
test/ui.test.ts
```

The additional names in the illustrative tree are optional extraction points,
not required files. They MUST NOT be added merely to satisfy this document.

The required UI design document is separate from the v1 TypeScript source:

```text
ui/
└── ui-ux.md
```

The `ui/` folder is the design and future host-integration boundary. It does
not authorize edits to the DeepSeek Harness web client; the plugin only emits
the state/events needed by the host integration.

No `scenario.ts`, private DSH imports, replacement runtime, private database,
or source file under `deepseek-harness` is part of this structure.

## 12. Verification requirements

The package MUST pass its typecheck, build, and test commands using the public
DSH package versions declared by the package. Tests MUST verify:

### Command and canonical validation

- single `/debug run` accepts an object and rejects malformed/non-JSON args;
- one bracketed `/debug run [tool(... ) tool(...)]` group is accepted;
- waits and multiple sequential calls are rejected by `/debug run`;
- canonical single, parallel, and wait steps validate;
- leading, trailing, consecutive, and nested waits fail;
- absent waits receive 100 ms, explicit waits survive unchanged, and the
  overwrite option replaces explicit waits only;
- unsupported versions, unknown fields, invalid JSON objects, and conversion
  mismatches produce invalid-script diagnostics.

### Adapter and real-loop contract

- valid input emits complete tool-call blocks and `finish: tool-calls`;
- no tool-call deltas are emitted;
- the final response emits one full text delta and `finish: stop`;
- the adapter does not consult a tool registry or directly execute a tool;
- results are awaited before the next scripted response;
- unknown tools and invalid arguments come from the real ToolRuntime and stop
  later steps;
- policy/approval, execution errors, invalid output, and cancellation preserve
  normal DSH behavior;
- background-job tools remain usable, while nested/subagent replay is rejected
  or explicitly reported unsupported;
- concurrent sessions remain isolated and cleanup releases all state.

### DSH JSONL conversion

- sibling calls in one `assistant/message` become one parallel group;
- calls from different agent steps stay sequential;
- timestamp gaps are converted only when reliable and are represented as
  explicit waits;
- historical results are omitted;
- conflicting records produce `CONVERSION_MISMATCH` with source locations;
- every adapter output passes the same canonical validator.

### External/plugin/UI behavior

- the compiled package loads through a normal Cordis composition;
- `mock-debug` and `debug` resolve, then disappear on plugin disposal;
- the persistent model-page selection is unchanged;
- slash debug, followup/steer debug, and real-provider turns coexist in one
  session;
- agent status remains running across intermediate steps and waits and becomes
  idle only at terminal completion/cancellation/error;
- durable DSH tool events remain authoritative;
- invalid-script, invalid-tool-stop, generic active indicator, and executable
  step-count behavior match section 9;
- replay performs no physical copy or write.

The tests MUST use a small public-API DSH composition with in-memory tools for
the core suite. Any shell/background-job smoke test MUST be opt-in and clearly
environment-dependent. The test suite MUST not require modifying or importing
private implementation files from the DeepSeek Harness checkout.

## 13. Limitations and non-goals

Version 1 does not replace any DSH runtime, does not make a real model request,
does not expose model-page debug selection, does not accept waits in `/debug
run`, does not replay historical tool results, and does not guarantee identical
wall-clock behavior when real tools have different durations. It supports one
tool or one parallel group for `/debug run`; multi-step behavior belongs to
canonical replay. It supports background-job tools through the real runtime,
but nested/subagent tools are outside deterministic replay. It does not persist
converted output or make a path policy decision that has not been approved.
