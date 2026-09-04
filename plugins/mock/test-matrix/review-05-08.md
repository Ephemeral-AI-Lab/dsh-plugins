# Review: backend matrix for areas 5–8

## Verdict

**AMBER — good breadth, but not yet a clean release-gate matrix.** The 58
rows (`ASTR` 14, `RTI` 15, `RTE` 14, `JOB` 15) cover the architecture in
`SPEC.md` unusually well on paper: the adapter is treated as a model boundary,
the main execution path is the real AgentLoop/ToolRuntime, and isolation,
approval, cancellation, jobs, and disposal are represented. The matrix should
be approved as a design draft after tightening scope and adding the race cases
below; it should not be treated as evidence that those behaviors are already
implemented or passing.

The main risks are not missing happy paths. They are (a) duplicate rows that
will make the suite expensive without increasing confidence, (b) assertions
that depend on private/runtime-internal observability, and (c) cancellation
ordering cases that are currently only described as broad scenarios.

This review is document-only. No test, build, server, or `pnpm` command was
run.

## Coverage that is justified

| Contract | Rows worth keeping | Verdict |
| --- | --- | --- |
| Normal `LlmAdapter` chunks and barriers | `ASTR-01..06`, `ASTR-09`, `ASTR-10`, `ASTR-12` | Strong unit boundary. Complete block-start/block-end chunks, `tool-calls` vs `stop`, explicit/implicit waits, out-of-order parallel results, and abort during a wait are all high-value. |
| No direct execution or local policy | `ASTR-11`, `RTI-11`, `RTI-12` | Justified, but use one unit proof plus one real-loop sentinel. The current two full boundary proofs are redundant; see below. |
| Real AgentLoop/ToolRuntime success and error semantics | `RTI-01`, `RTI-03..08`, `RTI-09..11`, `RTI-14`, `RTI-15` | Core integration coverage is appropriate. Parameterize the schema/runtime error cases, and compare host-owned error fields rather than brittle full messages. |
| Approval/policy | `RTI-09`, `RTI-10`, `RTI-11`, `RTE-14` | Good allow, pending, deny, and cancellation shape. A late decision after cancellation is still missing. |
| Followup, steer, and provider restoration | `RTE-01`, `RTE-02`, `RTE-04`, `RTE-05`, `RTE-08..12` | Correctly uses public turn surfaces and distinguishes active-turn interruption from post-result cancellation. Restoration after failure/cancel needs an explicit case. |
| Background jobs and unsupported subagents | `JOB-01..06`, `JOB-09` | The normal-job boundary, post-parent completion, explicit query, failure, abort, unsupported replay, and conversion behavior are justified. Child-session cases need a public-host-API prerequisite or smoke classification. |
| Isolation and cleanup | `ASTR-07`, `ASTR-13`, `ASTR-14`, `JOB-11`, `JOB-12`, `JOB-15` | Strong coverage of session keys, result correlation, per-session cleanup, and idempotent disposal. A stale result from an earlier turn in the same session is still missing. |
| Durable events | `RTI-15` plus the event assertions in `RTI-01`, `RTI-03..08`, `JOB-02`, `JOB-08` | Reload/no-replay is justified. Required mock lifecycle-event fields and the “optional extension unavailable” fallback are not asserted directly. |

## Redundant or over-scoped rows

These are not incorrect cases; they should be merged, parameterized, or
demoted so that the release suite remains fast and interpretable.

| Rows | Recommendation |
| --- | --- |
| `ASTR-11` and `RTI-12` | Keep `ASTR-11` as the fast unit proof that the adapter has no registry/`execute` handle. Retain `RTI-12` only as a short integration/smoke sentinel proving the real call enters through ToolRuntime; do not assert call-stack details or duplicate every adapter trace. |
| `RTI-05..08`, `RTI-11`, `RTI-13`, `RTI-14` | Use a parameterized runtime error table for unknown tool, invalid args, execution error, invalid output, and policy denial. `RTI-13` should be one normalized control-route oracle, not a second full run of every fixture. `RTI-14` should assert only fail-fast ordering/skipped steps. |
| `RTE-01..03` | Keep one followup and one steer turn-boundary integration case. Make `RTE-03` a parameterized equivalence assertion over the same harness, not two additional full journeys. |
| `RTE-06` and `RTE-07` | Parameterize the message surface (`followup`, `steer`) in one test; both paths still need to run. |
| `RTI-02` and `RTE-13` | Consolidate provider/model metadata and model-page non-mutation into one plugin-load smoke case. `RTE-08/09` remain the meaningful sequence tests. |
| `ASTR-13` and `JOB-14` | Keep one unit case for missing/empty `sessionId`; reference it from the isolation section instead of executing it twice. |
| `ASTR-14`, `RTE-05`, `JOB-10`, `JOB-15` | Separate adapter disposal, active-wait cancellation, and plugin/context disposal, but do not repeat the same zero-state assertions in every row. Provider unregistering belongs to the plugin-disposal integration case. |
| `JOB-11..13` | Keep `JOB-11` for functional two-session interleaving and `JOB-12` for ownership of one session's cleanup. Demote `JOB-13` to deterministic nightly stress; twenty sessions is valuable, but it is not a good per-commit release gate. |
| Source/host hashes in every failure row | Make `C2` one replay/source-safety smoke gate. Runtime error rows should not each snapshot the host checkout; this adds cost and obscures the actual assertion. Also rename “adapter execution count” to “fixture invocation count”: the adapter must not have an execution counter. |

Two scope corrections are important:

1. `ASTR-05` should not assert the UI/progress denominator. The stream unit
   can assert “no progress/tool chunk”; executable-step counting belongs to
   queue compilation or UI tests.
2. `ASTR-12` can assert emitted chunks and adapter cleanup, but not persistence.
   “Not persisted” belongs in a real-loop event test. Similarly,
   `cleanupProbe` should expose only a documented test seam or externally
   observable effects; counting arbitrary public-library listeners is brittle
   and may require private DSH inspection.

## Missing or underspecified edge cases

The existing matrix is missing the following high-value boundaries. IDs are
proposed additions, not claims about current implementation.

| ID | Severity | Level | Proposed case | Rough implementation / runtime |
| --- | --- | --- | --- | --- |
| `ASTR-15` | High | unit | Abort before the first chunk, including an already-aborted signal: exactly one aborted terminal, no call id, plan, timer, or listener. | 0.25–0.5 day / <1 s |
| `ASTR-16` | High | unit | Re-request the same stream step/re-enter `stream()` before its result: no duplicate block or call id, and only one cursor advances. | 0.5 day / <1 s |
| `RTI-16` | High | integration | One member of a parallel group fails while a sibling is delayed. Assert the host-defined sibling settlement/cancellation policy, one group terminal result, and no later top-level step. | 0.75–1 day / 2–5 s |
| `RTI-17` | Critical | integration | Abort while a real fixture is executing. The fixture sees the real signal, the normal cancellation result/event is durable, and no later step starts. | 0.75–1 day / 2–5 s |
| `RTI-18` | Critical | integration | Approval is pending, the turn is cancelled, then the controller resolves `allow`. The late decision must not execute the tool, advance the plan, or append a success lifecycle event. | 0.5–1 day / 1–3 s |
| `RTE-15` | Critical | integration | Deliver a tool result and interrupt in the same scheduling window. Exactly one terminal path wins; no duplicate finish, final event, idle transition, or later call. | 0.75–1 day / 1–3 s |
| `RTE-16` | High | integration | Dispose/tear down a session with a queued followup or steer command. The command is cancelled and cannot be delivered to a new session id. | 0.5 day / <2 s |
| `RTE-17` | High | integration | After a mock runtime error and after a mock cancellation, send ordinary text. Both paths restore the configured real provider/model and leave the model-page selection unchanged. | 0.5–0.75 day / 1–2 s |
| `JOB-16` | High | integration | Start a background job, capture the id returned by the real first step, and pass that returned id to a later query/wait step. Do not seed a hard-coded `job-A` for the data-flow assertion. | 0.75–1 day / 2–5 s |
| `JOB-17` | High | unit | Nested/subagent classification metadata is unavailable or throws. Refuse the deterministic replay with an explicit unsupported/indeterminate diagnostic; do not silently run it. | 0.5 day / <1 s |
| `JOB-18` | Critical | unit | A result from an old mock turn in the same session arrives after a new turn begins. It must be diagnosed and must not advance the new turn, even if the call id shape is otherwise valid. | 0.5 day / <1 s |
| `EVT-01` | Medium | integration | Validate serializable mock lifecycle events and reload them: session id, mock turn id, source mode/format/path when allowed, script id, executable-step count, and terminal status; no duplicate tool events. If the host has no public extension point, assert normal DSH events plus the documented unavailable diagnostic. | 0.5–0.75 day / 1–2 s |

The most release-critical additions are `RTI-17`, `RTI-18`, `RTE-15`, and
`JOB-18`: they protect against exactly-once execution, late approval, and
cross-turn state corruption. `RTI-16` and `JOB-16` are next priority because
they validate real runtime behavior that the current happy-path rows only
imply.

## Recommended test levels

Use the level names below consistently; the index uses `U/I/E` while the
05–08 table uses `unit/integration`, and it currently has no explicit smoke
level.

### Unit — release gate, every change

Keep the adapter contract in a fake-clock, fake-stream harness with no tool
registry: `ASTR-01..10`, `ASTR-12..13`, plus `ASTR-15..16` and `JOB-17..18`.
These should prove chunk shape, complete arguments, barriers, result
correlation, abort behavior, and cleanup without depending on DSH internals.
Parameterize equivalent arguments and error/result orderings.

### Integration — release gate, deterministic public DSH composition

Run a compact set through real `LlmRuntime`, `AgentLoop`, `ToolRuntime`,
`SessionStore`, policy/approval, and public job APIs: `RTI-01`, `RTI-03`,
`RTI-04`, one parameterized `RTI-05..11` table, `RTI-14..15`, `RTI-16..18`,
`RTE-01..02`, `RTE-04..05`, `RTE-08..12`, `RTE-14..17`, `JOB-01`, `JOB-03..06`,
`JOB-09`, `JOB-11..12`, `JOB-15..16`, and `EVT-01`. Use in-memory deterministic
tools/jobs and fake clocks where the public host APIs permit them. Do not
replace the loop or call fixture `execute` directly.

### Smoke-only/nightly — environment or host-shape dependent

Use a small number of smoke cases for compiled external loading and host
boundaries: consolidated `RTI-02/RTE-13`, the `RTI-12` execution sentinel,
`JOB-07..08` when the host creates child sessions, `JOB-10` with real external
job history, `JOB-13` twenty-session stress, and the `C2` source/replay safety
hash. These should be opt-in or nightly when they require a built package,
profile state, OS background jobs, or a host child-session implementation.
They must not be the only evidence for core adapter/runtime behavior.

## Exit recommendation

Before calling areas 5–8 complete:

- merge the duplicate rows and move cross-layer assertions to their owning
  level;
- add the proposed cancellation/late-result/late-approval cases;
- make background-job query data flow use the returned job id;
- define the public observability contract for cleanup and durable lifecycle
  events;
- compare stable DSH error codes/flags and event ordering, not exact prose;
- retain one compact smoke path for compiled plugin load, provider restoration,
  child-session behavior, and source immutability.

With those changes, the matrix is a credible unit/integration release gate;
without them, it is broad but over-counted and still vulnerable to the most
important cancellation and state-isolation regressions.
