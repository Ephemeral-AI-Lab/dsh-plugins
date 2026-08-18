# Runtime Test Matrix: Areas 5–8

Draft scope: the external `dsh-plugins/debug-agent` package only. This matrix
covers area 5 (adapter stream contract), area 6 (real `AgentLoop`/
`ToolRuntime` integration), area 7 (cancellation, followup, steer, and
provider routing), and area 8 (background jobs, subagents, session isolation,
and disposal). It does not authorize changes to DeepSeek Harness or to
production code.

The integration rows use the smallest real DSH composition from `test.md`:
`LlmRuntime`, `SessionStore`, `SystemPrompt` when required, `ToolRuntime`,
`AgentRegistry`, `AgentLoop`, and the compiled or source external plugin. A
fake loop, fake runtime, direct `ctx.llm` replacement, or private event store
does not satisfy an integration row.

## Fixture and oracle contract

The following named fixtures are shared by all rows. Each fixture records
session id, debug turn id, call id, invocation order, durable event order, and
abort state where applicable.

| Fixture | Setup and observable surface |
| --- | --- |
| `streamHarness` | Instantiates `MockDebugAdapter` with a seeded `session-A`/`run-A`, a fake clock, an async-stream collector, and an `AbortController`. It can feed current DSH-shaped tool-result messages, call `noteToolResult`, inspect plan/cursor/wait state, and collect adapter events. No tool registry or tool `execute` function is passed to the adapter. |
| `runtimeHarness` | Boots the real public DSH runtime and AgentLoop with the external plugin loaded. The session store captures assistant messages, `tool/call`, `tool/result`, final assistant stop, status transitions, and optional public debug lifecycle events. The host checkout is snapshotted before and after each run. |
| `probe_tool` | Publicly registered tool accepting `{ value }`; records exact args, session id, call id, execution entry point, and the signal; returns `{ ok: true, value }`. Its `execute` spy has an `outsideToolRuntime` sentinel. |
| `ordered_tool` | Public tool accepting `{ label, delayMs? }`; records start/finish order and uses the recording clock for deterministic delay and parallel-barrier checks. |
| `needs_value`, `throws_tool`, `bad_output` | Public schema/error fixtures: required string plus wrong type/extra-property variants; controlled execution throw; and deliberately invalid output against a declared output schema. |
| `approval_tool` | Public tool routed through the host policy/approval mechanism. `approvalController` can return allow, deny, or remain pending, and records the real policy decision. |
| `background_start`, `background_query` | Public background-job tool and a normal query/wait tool. The job registry records parent job id, child job state, completion after parent turn, cancellation, and failure without creating scripted child steps; the fixture may seed a deterministic `job-A` handle so a later scripted query can target real state. |
| `nested_agent` | Public nested/subagent fixture. The replay preflight must reject it with `UNSUPPORTED_NESTED_TOOL`, or preserve the host's normal visibility/policy error if the host hides it. |
| `realProviderSpy` | Deterministic normal provider that stays active on demand and records every request, session, turn, provider, model, and abort. It is used to prove non-slash routing and per-turn restoration. |
| `recordingSessionStore` | Real persistence interface backed by an isolated temporary test directory or in-memory store. It exposes event sequence, payload, reload, and duplicate-execution checks. |
| `runtimeErrorOracle` | Runs the same malformed/denied/throwing tool call through an ordinary deterministic provider and the same real DSH AgentLoop/ToolRuntime, then compares DSH-owned error class/code/message fields and durable event shape. |
| `cleanupProbe` | Counts adapter plans, active waits, abort listeners, subscriptions, registered providers, queued turns, and owned session references before/after terminal success, error, cancellation, session teardown, and plugin disposal. |

## Invariants

Each row names the invariants it proves. These are release-blocking when
violated.

| Code | Invariant |
| --- | --- |
| `S1` | The adapter emits model `StreamChunk`s only: complete tool-call blocks, `tool-calls` finish for intermediate responses, and one final text response with `stop`. It never emits a fake tool result. |
| `S2` | The adapter has no tool-registry/`execute` path. Tool lookup, schema validation, authorization, approval, execution, output validation, and durable tool events belong to real DSH runtime components. |
| `S3` | A wait is cancellation-aware scheduling state, never a tool call, tool result, progress step, or fake assistant message. |
| `S4` | A next scripted step is emitted only after all expected current-step results and the required explicit/implicit gap; a parallel group has no inter-member gap. |
| `S5` | Call ids, sessions, cursors, results, and terminal state correlate exactly; stale, duplicate, unknown, or cross-session results cannot advance a plan. |
| `R1` | Real `AgentLoop` and `ToolRuntime` are the only execution path. The registered tool sees one invocation with exact arguments; the adapter sees none. |
| `R2` | DSH-owned errors and policy/approval decisions retain their real codes, messages, events, output, and status semantics. The adapter does not pre-validate, rewrite, approve, or swallow them. |
| `R3` | Runtime failure, denial, invalid output, unsupported nested tool, cancellation, or abort fails fast according to the host contract and prevents later scripted steps. |
| `R4` | Durable assistant/tool events are authoritative and ordered. A presentation summary cannot replace a real result or cause historical results to execute again. |
| `P1` | A slash command selects `{ provider: "mock-debug", model: "debug" }` for that turn only; the configured model page and later real-provider turns are unchanged. |
| `P2` | Followup and steer classify `/debug` identically at the next turn boundary; non-slash text always uses the configured real provider. |
| `P3` | Cancellation settles the active stream/wait/approval/job relationship through normal DSH status transitions and cannot leak or replay a later step. |
| `I1` | All mutable plan state is keyed by DSH `sessionId` and debug turn id; concurrent sessions never consume each other's calls, waits, results, events, or routes. |
| `I2` | Background jobs remain normal DSH jobs; nested-agent replay is rejected or remains a distinct host child session and is never flattened into the parent script. |
| `C1` | Success, runtime error, cancellation, session teardown, and plugin disposal release plans, timers, listeners, subscriptions, queued commands, and owned references. Cleanup is idempotent. |
| `C2` | The DeepSeek Harness source tree and the replay input file are byte-for-byte unchanged by every test path. |

## Area 5 — adapter stream contract

The unit rows exercise the adapter as a model boundary with a fake clock and
DSH-shaped messages. The integration row is intentionally repeated at the
boundary so the direct-execution prohibition is proven both in isolation and
inside a real turn.

| ID | Case | Difficulty | Level | Fixture/setup | Expected result | Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| `ASTR-01` | One complete tool call | Easy | unit | `streamHarness`; one-step `probe_tool({"value":"ok"})`; collect all chunks. | Emit one `block-start`, one `block-end` containing a complete tool-call with JSON-stringified args, then `finish(kind=tool-calls)`; no stop/fake result. | `S1`, `S2` |
| `ASTR-02` | Complete JSON args are emitted atomically | Easy | unit | `needs_value({"value":"alpha"})`; assert chunk types and block payload. | Emit no `tool-call-delta`; block-end contains the exact round-trippable object and valid tool name. | `S1`, `S2` |
| `ASTR-03` | Parallel response has complete unique calls | Easy | unit | One parallel step with `ordered_tool({"label":"a"})` and `ordered_tool({"label":"b"})`. | Both calls are emitted in source order with distinct ids; every block-end precedes the one `tool-calls` finish; no inter-member timer. | `S1`, `S4`, `S5` |
| `ASTR-04` | Sequential response barrier | Medium | unit | Two sequential `probe_tool` steps and the recording clock; supply only the first current-turn result. | First response ends `tool-calls`; second call is absent until the next stream request has the first result and the default 100 ms gap has elapsed. | `S3`, `S4` |
| `ASTR-05` | Explicit wait is not a tool | Medium | unit | Script `ordered_tool(a)`, `wait:250`, `ordered_tool(b)`; inspect chunks, timers, and adapter events. | Adapter enters waiting state, emits no call/result/progress chunk, then emits `b` only after 250 ms; wait is absent from tool-call count and executable denominator. | `S3`, `S4` |
| `ASTR-06` | Out-of-order parallel results | Medium | unit | Parallel `ordered_tool(a/b)`; return `b` before `a` with current call ids. | Each result is correlated by id; no next response occurs after only `b`; after both arrive, exactly one next-step response is emitted. | `S4`, `S5` |
| `ASTR-07` | Unknown, stale, and cross-session result | Medium | unit | Start plans for `session-A` and `session-B`; feed A an unknown id, a duplicate id, and B's id in separate runs. | Each protocol violation produces a deterministic terminal diagnostic for the affected request; no other pending call/cursor/session advances. | `S5`, `I1` |
| `ASTR-08` | Real error result stops the queue | Medium | unit | Multi-step plan with `probe_tool`, `throws_tool`, then `probe_tool`; report the middle result as `isError` with `EXECUTION_ERROR`. | Adapter marks the plan failed/canonical terminal, emits no later call, and retains the DSH error code for the host; no success stop is reported. | `R2`, `R3`, `S5` |
| `ASTR-09` | Final stop occurs only at queue end | Hard | unit | Three executable steps with an explicit wait and a parallel group; supply all current results in varied order. | Intermediate streams always finish `tool-calls`; exactly one final text response/`stop` occurs after the last durable result and required wait, then plan state is released. | `S1`, `S3`, `S4`, `C1` |
| `ASTR-10` | Abort during a wait | Hard | unit | Script `probe_tool(a)`, `wait:1000`, `probe_tool(b)`; start second stream, then abort its signal before clock advance. | Timer and abort listener are cleared; stream ends through the normal aborted path, `b` is never emitted, and no later request can consume the cancelled cursor. | `S3`, `P3`, `C1` |
| `ASTR-11` | Adapter cannot directly invoke a tool | Hard | unit | Register `probe_tool` only in a separate test registry whose `execute` spy throws `DIRECT_ADAPTER_EXECUTION`; pass no registry/runtime handle to `MockDebugAdapter`; stream a two-step plan and feed synthetic result messages. | Adapter produces only chunks/state; `execute` count remains zero and the sentinel is never thrown. Tool execution is possible only when the real integration harness later owns the call. | `S1`, `S2`, `R1` |
| `ASTR-12` | Abort between block start and block end | Hard | unit | Manually advance the async iterator after `block-start`, abort, then request the next chunk. | No complete tool-call block is fabricated or persisted; the aborted finish is settled once, pending state is cleared, and no duplicate call id is exposed. | `S1`, `S5`, `P3`, `C1` |
| `ASTR-13` | Missing session id is rejected | Easy | unit | Call `stream()` with no session id and separately with an empty id; do not create a fallback plan. | Return the documented `DEBUG_SESSION_REQUIRED`/aborted diagnostic; no shared fallback key, plan, timer, or tool-call chunk is created. | `S5`, `I1`, `C1` |
| `ASTR-14` | Dispose an active stream | Hard | unit | Start a plan with a pending parallel result and active wait; call `adapter.dispose()` twice while the stream is pending. | Active stream settles, all waits/signals/plans are zero, the second dispose is a no-op, and no post-disposal response or provider-owned reference remains. | `P3`, `C1` |

## Area 6 — real AgentLoop and ToolRuntime integration

Every row below runs through the public DSH loop and runtime. Assertions must
record both the registered fixture invocation and the durable event sequence;
directly calling a fixture's `execute` function is not a substitute.

| ID | Case | Difficulty | Level | Fixture/setup | Expected result | Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| `RTI-01` | Valid single probe call | Easy | integration | `runtimeHarness`; compiled plugin; `probe_tool({"value":"ok"})`; empty session. | One real execution with exact args; durable assistant tool-call, `tool/call`, `tool/result`, final assistant stop, and terminal idle are present. | `R1`, `R4`, `C2` |
| `RTI-02` | External provider/model registration | Easy | integration | Load `lib/index.js` as an external package; query public provider/model metadata without changing the agent model page. | `mock-debug` and `debug` are discoverable for plumbing, the debug command selects them for one turn, and the persistent configured route remains unchanged. | `P1`, `C2` |
| `RTI-03` | Real sequential multi-step workflow | Medium | integration | Canonical script `probe_tool(one)`, `ordered_tool(middle)`, `probe_tool(last)`; `recordingSessionStore`. | Each tool executes once through `ToolRuntime`; step 2 starts after step 1 result/default gap and step 3 after step 2; no later call is emitted early. | `R1`, `S4`, `R4` |
| `RTI-04` | Real parallel group barrier | Medium | integration | Parallel `ordered_tool(a/b)` with different deterministic delays, followed by `probe_tool(last)`. | Both siblings enter `ToolRuntime` without plugin inter-member waits; the next step starts only after both terminal results; finish order may differ but event correlation is exact. | `R1`, `S4`, `R4` |
| `RTI-05` | Unknown tool uses DSH error path | Medium | integration | Script calls `not_registered({})`, then `probe_tool(should-not-run)`. Do not register a parser-only stub. | Adapter still emits the call; real runtime emits `UNKNOWN_TOOL`, no fixture executes, later step is skipped, and session becomes terminal/idle without a stuck plan. | `R1`, `R2`, `R3` |
| `RTI-06` | Invalid argument matrix | Medium | integration | Parameterize `needs_value` with missing required field, wrong type, and disallowed extra property; append a valid later step. | Real schema/runtime emits its normal `INVALID_ARGS`/schema code for each input; `execute` count is zero for the invalid call, later step is skipped, and adapter does not issue a second validation diagnostic. | `R1`, `R2`, `R3` |
| `RTI-07` | Controlled execution error | Medium | integration | `throws_tool({"message":"fixture failure"})` followed by `probe_tool`. | Normal DSH execution error code/message and `tool/result` error payload persist; the skipped-step list contains the later probe and no adapter rewrite or later tool execution occurs. | `R1`, `R2`, `R3`, `R4` |
| `RTI-08` | Invalid output is preserved | Medium | integration | `bad_output({})` with a declared output schema and a later valid step. | ToolRuntime performs output validation, records the normal invalid-output error/result, skips later work, and leaves the session idle/terminal. | `R1`, `R2`, `R3` |
| `RTI-09` | Existing policy allows | Medium | integration | `approval_tool({})`; configure host policy to allow and capture the decision/event. | The host policy path records allow and ToolRuntime executes once; the adapter neither authorizes nor duplicates the approval decision. | `R1`, `R2`, `R4` |
| `RTI-10` | Pending approval then allow | Hard | integration | Multi-step script with `approval_tool` then `probe_tool`; `approvalController` holds the first decision pending, then allows. | Agent remains running/pending with no next call or final stop while pending; after allow, the approved call resumes exactly once, next step runs, and durable approval/result events remain ordered. | `R2`, `R3`, `R4`, `P3` |
| `RTI-11` | Policy denial is not adapter approval | Hard | integration | `approval_tool` with host policy denial, followed by `probe_tool`; inspect adapter and runtime traces. | Real policy denial/error is surfaced unchanged, no tool implementation runs, no later step starts, and the adapter has no approval callback or bypass path. | `S2`, `R1`, `R2`, `R3` |
| `RTI-12` | Direct-execution boundary in a real turn | Hard | integration | `probe_tool` `execute` is guarded by a runtime-scope marker and records call stack/owner; run through the real plugin/AgentLoop/ToolRuntime. | Exactly one execution is entered from the ToolRuntime path after a real `tool/call`; adapter trace contains no execute invocation, registry access, policy decision, or result fabrication. | `S2`, `R1`, `R4` |
| `RTI-13` | DSH error-semantics oracle | Hard | integration | For `UNKNOWN_TOOL`, invalid `needs_value`, `throws_tool`, `bad_output`, and policy deny, run the same call through `runtimeErrorOracle` control provider and debug route. | DSH-owned error class/code/message, `tool/result` error flag/payload, status transition, and stop/skip behavior match the control route; only provider/turn metadata differs. | `R2`, `R3`, `R4`, `C2` |
| `RTI-14` | Fail-fast multi-step runtime failure | Hard | integration | Five-step script: valid `probe_tool`, failing `throws_tool`, valid sequential tool, parallel group, and final tool; capture call ledger and skipped-step state. | First failure is durable; no call from any later step is emitted or executed, skipped list is observable, and agent is not permanently busy. | `R1`, `R3`, `R4` |
| `RTI-15` | Durable event reload does not replay tools | Hard | integration | Complete a two-step script using `recordingSessionStore`; close/reload the session and inspect the compiled plugin state. | Reload reconstructs authoritative assistant/tool/final events and terminal status with zero new fixture invocations; historical results are not fed back as fresh calls and host source remains unchanged. | `R4`, `C1`, `C2` |

## Area 7 — cancellation, followup, steer, and provider routing

These rows send inputs through the host command/message surfaces. Direct calls
to `parseDebugCommand` can supplement, but cannot replace, the turn-boundary
assertion for followup and steer.

| ID | Case | Difficulty | Level | Fixture/setup | Expected result | Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| `RTE-01` | Debug followup while real turn is active | Medium | integration | `realProviderSpy` keeps a normal turn active; enqueue `/debug run probe_tool({"value":"followup"})` through public followup. | Current real turn is not rewritten; followup is queued as the next turn, then selects `mock-debug/debug` and executes one real tool call. | `P1`, `P2`, `P3` |
| `RTE-02` | Debug steer while real turn is active | Medium | integration | Same active real turn and command as `RTE-01`, sent through public steer. | Steer has the same next-turn semantics, canonical plan, tool args, wait behavior, and terminal events as followup; current turn remains intact. | `P1`, `P2`, `S4` |
| `RTE-03` | Followup and steer equivalence | Easy | integration | Run identical one-step and two-step debug commands once as followup and once as steer in isolated sessions. | After removing generated ids/timestamps, event kinds, route, args, waits, completion/error, and status sequence are equivalent. | `P1`, `P2`, `R4` |
| `RTE-04` | Interrupt active multi-step debug stream | Hard | integration | Start a three-step debug script with `ordered_tool` active, interrupt during the first stream/result boundary. | Current call receives normal abort/cancellation; later steps are not silently emitted, stream/agent become idle per host contract, and no completion event is written. | `P3`, `R3`, `C1` |
| `RTE-05` | Interrupt explicit wait | Hard | integration | Script has completed step 1 and `wait:5000`; interrupt while recording clock shows one active timer. | Timer and listener cancel through normal DSH path; no next tool/fake wait tool event appears; status is cancelled/idle and cleanup probe is zero. | `S3`, `P3`, `C1` |
| `RTE-06` | Non-slash followup uses real provider | Easy | integration | Active or idle session configured with `realProviderSpy`; send `probe_tool({"value":"looks-like-data"})` as ordinary followup without `/debug`. | Debug parser/plan/provider are not invoked; real provider receives the message with its configured route and no tool call is manufactured by the plugin. | `P1`, `P2` |
| `RTE-07` | Non-slash steer uses real provider | Easy | integration | Same as `RTE-06`, but send the text through steer. | Host routes ordinary steer text to the configured real provider; no debug queue, route substitution, or adapter stream is created. | `P1`, `P2` |
| `RTE-08` | Real turn followed by debug turn | Medium | integration | Configure provider/model `realProviderSpy/real-model`; complete a normal turn, then submit `/debug run probe_tool({"value":"debug"})`. | Normal turn persists under its real route; only the debug turn uses `mock-debug/debug`; session transcript distinguishes both routes and later state is idle. | `P1`, `R4` |
| `RTE-09` | Debug turn followed by real turn | Hard | integration | Complete a debug turn, then send ordinary text with `realProviderSpy` configured; inspect AgentLoop request headers and agent options. | Debug plan is consumed/cleared; next request restores the configured provider/model without mutating persistent model-page selection or reusing debug state. | `P1`, `I1`, `C1` |
| `RTE-10` | Malformed slash command then normal text | Medium | integration | Send malformed `/debug run probe_tool({'value':'bad'})` or wait syntax, then a normal message in the same session. | First input produces `INVALID_COMMAND` with no tool call/plan; second input still reaches the real provider and cannot inherit failed debug routing. | `R2`, `P1`, `P2`, `C1` |
| `RTE-11` | Followup/steer queues isolated across sessions | Hard | integration | `session-A` has a real active turn plus debug followup for `probe_tool(A)`; `session-B` has steer for `probe_tool(B)`; interleave turn completion. | Each command is consumed only by its session, with distinct route, call id, args, events, status, and final result; neither queue/cursor is global. | `P2`, `I1`, `R4` |
| `RTE-12` | Cancel after result before next step | Hard | integration | Multi-step debug script; allow step 1 result to persist, abort before the implicit/explicit next-step request. | Step 1 remains durable, no step 2 call is emitted/executed, plan and timers clear, and a later ordinary turn cannot replay step 2 accidentally. | `S4`, `P3`, `R3`, `C1` |
| `RTE-13` | Provider metadata is not a model-page mutation | Easy | integration | Query `providerInfo`/`listModels`, inspect agent configured route before and after a debug command. | Metadata is available for plumbing/tests, but the persistent configured provider/model and user-facing model-page choice are byte-for-byte unchanged. | `P1`, `C2` |
| `RTE-14` | Cancel while approval is pending | Hard | integration | Start a multi-step debug turn on `approval_tool`; hold approval pending, then interrupt and inspect policy controller, stream, and session events. | Pending approval is cancelled by normal host semantics, no approval or tool execution occurs afterward, later steps are skipped, and all listeners/plan state are released. | `R2`, `R3`, `P3`, `C1` |

## Area 8 — background jobs, subagents, isolation, and disposal

Job rows must use the normal DSH job system. The plugin must not virtualize
job state, turn a job into an implicit scripted step, or flatten a child
session into its parent.

| ID | Case | Difficulty | Level | Fixture/setup | Expected result | Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| `JOB-01` | Allowed background start | Medium | integration | One-step debug script invokes `background_start({"label":"short"})`; job registry returns a real job id immediately. | Parent has normal `tool/call`/`tool/result` and final stop; job id/state remain in the normal job system and are not copied into a fake scripted result. | `R1`, `R4`, `I2` |
| `JOB-02` | Job completes after parent | Medium | integration | Start a delayed background job, let parent debug turn complete, then complete the job out of band and reload. | Parent completion occurs after its durable result/final stop only; delayed job completion creates no duplicate replay completion or extra scripted step and remains observable normally. | `R4`, `I2`, `C2` |
| `JOB-03` | Explicit later job query in a multi-step script | Hard | integration | Seed real handle `job-A`; script starts `background_start({"label":"a"})`, then explicitly calls `background_query({"jobId":"job-A"})`/wait tool, then `probe_tool(last)` using real job state. | Queue advances only on real results; later query determines its own completion; job state is not inferred by adapter and final step waits for the query result. | `S4`, `R1`, `I2`, `R4` |
| `JOB-04` | Background job failure | Hard | integration | Start a job configured to fail, then run a later normal scripted step; capture parent/job events separately. | Normal job failure code/status is preserved; parent behavior follows the documented DSH parent/child contract, with no adapter rewrite or hidden retry and no unintended later step. | `R2`, `R3`, `I2`, `R4` |
| `JOB-05` | Parent abort with child job running | Hard | integration | Start delayed `background_start`, abort the parent during or immediately after the call, then observe job cancellation policy. | Parent cancellation is durable and settles its stream; child cancellation/final state follows normal job policy, unrelated job records remain, and no plan/timer/listener leaks. | `P3`, `I2`, `C1`, `C2` |
| `JOB-06` | Nested-agent first step | Medium | integration | Replay canonical script beginning with `nested_agent({})`, followed by `probe_tool`; run replay preflight and then inspect runtime. | Replay returns one deterministic `UNSUPPORTED_NESTED_TOOL` (or documented host visibility/policy error), makes no hidden child success claim, and skips the later step. | `R2`, `R3`, `I2` |
| `JOB-07` | Nested-agent inside parallel group | Hard | integration | Parallel group contains `nested_agent` and `probe_tool`, followed by another step; configure both visible and host-hidden variants. | Group failure/settlement policy is deterministic; no child result is consumed as the next scripted response, no flattening occurs, and later top-level step does not start. | `R3`, `I2`, `R4` |
| `JOB-08` | Host-created child remains distinct | Hard | integration | Use a host configuration that creates a child session before reporting nested-tool rejection; capture parent/child ids and event stores. | Child id, status, events, cleanup, and job records remain distinct; parent persistence contains no flattened child messages/tool results and parent does not reuse child state. | `I1`, `I2`, `R4` |
| `JOB-09` | Replay log containing child records | Medium | unit | Convert a DSH JSONL fixture containing parent records plus child-session/nested-agent records with source locations. | Converter rejects unsupported flattening with explicit diagnostic or applies the documented exclude-child policy; it never schedules historical child results as parent calls. | `R3`, `I2`, `C2` |
| `JOB-10` | Dispose with parent and child jobs | Hard | integration | Keep a parent plan, active wait, and normal child job alive; dispose the plugin/context and inspect `cleanupProbe` plus external job history. | Provider unregisters; plugin-owned plans/timers/listeners/subscriptions clear; external job history is not deleted or rewritten; disposal is terminal and observable. | `I2`, `C1`, `C2` |
| `JOB-11` | Concurrent sessions use one adapter safely | Hard | integration | `session-A` runs `probe_tool(A)` plus a wait; `session-B` runs `probe_tool(B)` plus a different parallel group; interleave result completion with one adapter instance. | Calls, ids, args, results, cursors, waits, summaries, durable events, and status remain session-scoped despite interleaving; no cross-session advancement occurs. | `I1`, `S5`, `R4` |
| `JOB-12` | A cleanup cannot clear B's wait | Hard | integration | A finishes while B is in a 5-second explicit wait; dispose/teardown A only, then advance B's clock. | A reaches terminal cleanup while B's timer/cursor continues and B emits its own next step; per-session teardown never calls global clear/dispose. | `I1`, `C1`, `S3` |
| `JOB-13` | Twenty-session interleaving and bounded cleanup | Hard | integration | Deterministic seed starts at least 20 sessions with mixed one-step, sequential, parallel, wait, error, and cancellation scripts; randomize result completion and dispose half mid-run. | Every terminal session has zero owned plans/timers/listeners; survivors remain correct; no id/result/event crosses sessions; final plugin disposal leaves zero adapter-owned state. | `I1`, `C1`, `R3`, `R4` |
| `JOB-14` | Missing session id never uses global fallback | Easy | unit | Start/stream/cancel requests with absent or empty `sessionId` while A and B have active plans. | Request is clearly rejected or request-local state is destroyed before return; A/B plans are untouched and no fallback session receives the call. | `I1`, `S5`, `C1` |
| `JOB-15` | Idempotent disposal and new-session boundary | Medium | integration | Run one active session, call plugin/context disposal twice, then attempt a new session and a stale old call id. | Second disposal emits no duplicate events/errors; provider cannot serve old/new debug responses after disposal, and stale state cannot be consumed by a new session. | `I1`, `C1`, `S5` |

## Difficulty and hard-case coverage audit

The matrix contains 11 easy, 21 medium, and 26 hard cases, exceeding the
required minimum of 10 in each difficulty. The following hard cases provide
the required complex-runtime coverage:

| Required hard capability | Representative hard cases |
| --- | --- |
| Multi-step workflow and fail-fast queue | `ASTR-09`, `RTI-10`, `RTI-14`, `RTE-04`, `JOB-03` |
| Real tool execution through DSH | `RTI-10`, `RTI-12`, `RTI-14`, `JOB-03`, `JOB-11` |
| Policy and approval | `RTI-10`, `RTI-11`, `RTE-14` |
| Durable events and reload | `RTI-13`, `RTI-14`, `RTI-15`, `JOB-04`, `JOB-08` |
| Concurrent sessions | `RTE-11`, `JOB-11`, `JOB-12`, `JOB-13` |
| Cancellation/interrupts | `ASTR-10`, `ASTR-12`, `RTE-04`, `RTE-05`, `RTE-12`, `RTE-14`, `JOB-05` |
| Background jobs | `JOB-03`, `JOB-04`, `JOB-05`, `JOB-10`, `JOB-13` |
| Cleanup and disposal | `ASTR-09`, `ASTR-10`, `ASTR-14`, `RTE-05`, `RTE-09`, `RTE-14`, `JOB-10`, `JOB-12`, `JOB-13`, `JOB-15` |
| Adapter never directly invokes tools | `ASTR-11`, `RTI-12` |
| Real DSH error semantics preserved | `RTI-05`, `RTI-06`, `RTI-07`, `RTI-08`, `RTI-11`, `RTI-13`, `JOB-04` |

For every failure row, the evidence bundle must include the
failing DSH error code/payload, the skipped/not-started later-step list, the
normal status transition to terminal/idle, the adapter execution count of
zero for invalid/non-authorized calls, and the unchanged host/source hashes.
