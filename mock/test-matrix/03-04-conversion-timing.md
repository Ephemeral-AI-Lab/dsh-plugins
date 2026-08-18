# Test matrix: areas 3–4 — conversion, timing, and replay queues

Draft scope: DSH JSONL/format conversion and timing plus replay-queue
construction. These cases exercise the external `mock` contract from
`SPEC.md` and `test.md`; they do not authorize changes to DeepSeek Harness or
production code.

## Levels and fixture notation

- **U** — pure parser/converter/queue test with in-memory fixtures and
  `recordingClock`.
- **I** — real DSH `AgentLoop`/`ToolRuntime` integration with deterministic
  registered fixtures and `recordingSessionStore`.
- **E** — compiled external plugin replay against a source file/profile,
  including file-byte and durable-event checks.

JSONL fixture shorthand uses the required fields `type`, `seq`, `time`, and
`data.turn`/`data.step`. `session(S)` is a valid first nonblank session
header. `message(T,S,[...])` is one `assistant/message`; `call(name,args,id)`
is a complete tool-call block; `tool/call` and `tool/result` are durable
historical records. Unless stated otherwise, `a`, `b`, and `c` are valid
registered tools and arguments shown are JSON objects.

## Invariant catalog

| Code | Invariant |
| --- | --- |
| I1 | Every accepted input has one canonical `dsh-mock-script` representation before queue compilation. |
| I2 | Self-authored and converted inputs use the same strict canonical validator. |
| I3 | Conversion/adapter code never executes tools or manufactures current results; execution remains in real `ToolRuntime`. |
| I4 | Historical results, approvals, output, and source call ids are evidence/diagnostics only, not replay actions or live ids. |
| I5 | A wait is scheduling state only: no tool call/result/progress event and no fake tool execution. |
| I6 | Sibling calls in one parallel step retain order, have no inter-member gap, and release the next top-level step only at the group barrier. |
| I7 | Invalid input fails before the first call; a runtime failure stops later top-level steps according to fail-fast policy. |
| I8 | Completion requires the final model stop and durable event; waits, unresolved results, and active streams remain nonterminal. |
| I9 | Queue cursor, pending calls, results, timers, and errors are scoped to the session and current plan. |
| I10 | Cancellation/disposal settles waits and streams and leaves no owned timer, listener, or pending plan. |
| I11 | Replay is in-memory and source files remain byte-for-byte unchanged, including under overwrite options and failure. |

Difficulty distribution across this draft: **13 easy**, **10 medium**, and
**11 hard**. Each case includes the requested ID, difficulty, level,
fixture/input, expected result, and invariant.

## Area 3 — DSH JSONL and format conversion

| ID | Difficulty | Level | Fixture/input | Expected result | Invariant |
| --- | --- | --- | --- | --- | --- |
| C-01 | Easy | U | `session(S)` followed by one `message(1,1,[call("probe_tool", {"value":"ok"}, old-1)])`. | Produces canonical `{"type":"dsh-mock-script","version":1,"steps":[{"tool":"probe_tool","args":{"value":"ok"}}]}` with no source metadata in `steps`. | I1, I4 |
| C-02 | Easy | U | One assistant message `message(1,4,[call("a", {"n":1}, old-a), call("b", {"n":2}, old-b), call("c", {}, old-c)])`. | Produces one `{ "parallel": [...] }` step, preserving `a,b,c` content order; no three sequential steps and no waits between members. | I1, I6 |
| C-03 | Easy | U | `message(1,2,[call("a", {}, id-a)])`, then `message(1,3,[call("b", {}, id-b)])`, then `message(1,4,[call("c", {}, id-c)])`. | Produces three sequential top-level tool steps in source step order; each message boundary is preserved and no calls are merged across steps. | I1, I6 |
| C-04 | Easy | U | `message(2,7,[call("a", {"value":"original"}, old-a)])` interleaved with `tool/call(old-a)` and duplicate `tool/result(old-a, {"value":"historical"})`. | Produces only the fresh `a({"value":"original"})` step; historical result content is absent from canonical args and no result is added as a step. | I3, I4 |
| C-05 | Easy | U | A complete call `call("needs_value", {"value":"x","nested":{"ok":true}}, old-9)` in a valid assistant message. | Copies the name and JSON values exactly into `tool` and `args`; old call id is available only in source diagnostics and is not emitted as a live id. | I1, I4 |
| C-06 | Easy | U | LF and CRLF versions of the same JSONL fixture, with blank lines before/after `session(S)` and between records. | Both normalize to byte-equivalent canonical JSON; blank lines are ignored only where allowed, and the first nonblank session header is required. | I1, I2 |
| C-07 | Medium | U | Two distinct groups: first terminal source time `100`, next group first-call time `275`, same known millisecond unit and reliable `data.step` boundary. | Inserts exactly one explicit `{ "wait": 175 }` between the two executable steps; the gap is not left as guessed source text. | I1, I5 |
| C-08 | Medium | U | With timing preservation enabled, compare four fixtures: equal comparable times `100/100`; both times missing; times with different/unknown units; and a negative/nonmonotonic boundary. | Equal times yield explicit `wait: 0`; missing or incomparable timestamps yield no timing-derived wait so queue defaults apply later; negative/nonmonotonic timing rejects under the documented conversion policy; no guessed negative or unit-converted gap is produced. | I1, I2, I5, I7 |
| C-09 | Medium | U | Same assistant step has `message(... call("a", {"x":1}, id-1))` but a durable record for the same identity says `name:"b"` or `args:{"x":2}`. | Rejects before queue compilation as `CONVERSION_MISMATCH`, identifying input path/line records and conflicting name/args fields; no tool call occurs. | I2, I7 |
| C-10 | Medium | U | Invalid source variants: malformed JSON on line 3; scalar JSON line; `call("a", "not-an-object", id)`; invalid tool name; and incomplete call missing arguments. | Each variant rejects with conversion/invalid-script error and 1-based source location; canonical output is not returned and no partial queue is created. | I2, I7 |
| C-11 | Hard | U | Run two precedence fixtures: (a) valid complete `assistant/message` call plus valid packed/delta duplicates; (b) no complete message, malformed packed fragment, and valid delta fallback for the same call. | (a) Uses the complete message once. (b) Rejects the malformed higher-priority packed representation instead of silently falling back to delta. No representation duplicates calls. | I1, I2, I7 |
| C-12 | Hard | I | Replay JSONL where an old `tool/result` contains output that would make the next call appear unnecessary, e.g. historical `probe_tool` result `{ "ok":true }` before a scripted `needs_value({"value":"fresh"})`. | Real `ToolRuntime` invokes both current scripted calls required by the canonical steps; historical output is not injected, copied, or used to skip/alter the next call. | I3, I4 |
| C-13 | Hard | E | Snapshot bytes/hash/size/last-write marker of `replay.jsonl`; replay it with `--overwrite-wait-time-ms 50`, then repeat after a runtime failure and cancellation. | Canonical plan is transformed only in memory; source is byte-for-byte unchanged, not renamed/deleted/truncated/appended, and no converted sidecar/temp replay file is created. | I4, I11 |
| C-14 | Hard | U | Converter output includes an illegal leading wait, trailing wait, consecutive waits, or wait inside `parallel`, plus an unknown top-level field. | Shared canonical validator rejects the result as `INVALID_SCRIPT` before queue compilation; no adapter-specific weaker acceptance or first tool call occurs. | I1, I2, I7 |
| C-15 | Hard | U | Records arrive out of physical line order: `seq` orders step 1 before step 2, while three sibling calls in one message have array order `b,a,c`; unrelated `turn/step` values are distinct. | Groups by documented durable ordering, outputs sequential steps in step order, and retains sibling array order `b,a,c`; it never merges unrelated steps because lines were adjacent. | I1, I6, I9 |
| C-16 | Hard | I | One call is represented by a complete message, a durable `tool/call`, and two duplicate `tool/result` records; execute through a real session and inspect emitted blocks/events. | Exactly one new model tool call is emitted with a fresh id; duplicate historical results do not create duplicate invocations/results, and durable current events correlate to the new id. | I3, I4, I8 |

## Area 4 — timing and replay-queue construction

| ID | Difficulty | Level | Fixture/input | Expected result | Invariant |
| --- | --- | --- | --- | --- | --- |
| Q-01 | Easy | U | Valid canonical script with one `{ "tool":"a","args":{} }`. | Queue has one executable step, no leading/trailing wait, one tool-call emission, and final stop only after its result. | I5, I8 |
| Q-02 | Easy | U | Two sequential tool steps `a -> b` with no explicit wait. | Queue inserts exactly one implicit 100 ms gap after `a` completes and before `b` is emitted; no gap precedes `a` or follows `b`. | I5, I8 |
| Q-03 | Easy | U | One `{ "parallel":[a({}),b({}),c({})] }` step. | All three calls are emitted in one assistant response with no plugin-owned inter-member wait; group counts as one executable step. | I5, I6 |
| Q-04 | Easy | U | `a`, explicit `{ "wait":250 }`, then `b`. | Recording clock observes one 250 ms wait, not `250+100` and not 100; wait begins only after `a` reaches its terminal result. | I5, I8 |
| Q-05 | Easy | U | `a`, explicit `{ "wait":0 }`, then `b`. | Queue preserves the explicit edge with zero elapsed delay, emits no generic wait spinner/event, and still advances to `b` after `a`'s result. | I5, I8 |
| Q-06 | Easy | U | `a -> b -> c`, with an explicit 250 ms wait only between `a` and `b`. | Schedule is `a --250 ms--> b --100 ms--> c`; omitted edges retain the 100 ms default and explicit value is not added to it. | I5, I8 |
| Q-07 | Easy | U | `a`, explicit waits 250 and 0 on two edges, `b`, `c`, compiled with `--overwrite-wait-time-ms 50`. | Both explicit waits become 50 in memory; any omitted edge remains 100, queue membership/order is unchanged, and source/canonical input is unchanged. | I1, I5, I11 |
| Q-08 | Medium | U | `a -> parallel[b,c] -> d`, no explicit waits. `b` and `c` complete at different fake times. | Queue waits for group completion, then applies one 100 ms edge gap before `d`; `d` cannot emit after the first sibling only, and no inter-member gap is inserted. | I5, I6, I8 |
| Q-09 | Medium | U | `parallel[a,b] -> c` with results delivered in order `b` then `a`, using distinct pending call ids. | Results correlate by id; group advances only after both terminal results, then exactly one next-step gap is scheduled before `c`; out-of-order completion does not reorder canonical membership. | I6, I9 |
| Q-10 | Medium | I | Real AgentLoop replay of `a -> b -> c`, with `a` returning normally and `b` returning `UNKNOWN_TOOL` or `INVALID_ARGS`. | Real ToolRuntime produces the authoritative error; queue enters terminal failure, emits no `c` call, preserves the failing tool/code, and becomes idle after normal error settlement. | I3, I7, I8 |
| Q-11 | Medium | I | Real AgentLoop replay of `parallel[a, throws_tool, b] -> c`; all sibling calls are emitted before results settle. | All already-emitted siblings settle through normal ToolRuntime; the group records deterministic failure, later top-level `c` is skipped, and adapter does not retroactively unsend/cancel siblings outside normal DSH behavior. | I3, I6, I7 |
| Q-12 | Medium | U | Valid script `a -> b -> c` compiled with explicit 0 ms after `a`, omitted edge after `b`, and overwrite option `0`. | Explicit wait becomes 0 while omitted edge stays 100; queue cursor advances once per executable step, not once per wait, and no wait is treated as a tool/progress step. | I5, I8 |
| Q-13 | Medium | U | `a -> wait(250) -> b`; recording observer captures wait-start/wait-end, tool-start/end, group completion, and terminal completion. | Observer order is `a end -> wait start/end -> b start/end -> final stop/durable completion`; agent/queue remains active during wait and no fake tool result or premature idle is observed. | I5, I8 |
| Q-14 | Hard | U | Two-step script `a -> b` with an implicit 100 ms gap; abort signal fires 40 ms into the fake-clock wait. | Cancellation-aware delay settles through abort path, cancels timer, skips `b`, emits no later response, ends aborted/idle per host contract, and reports zero pending timers/listeners. | I5, I8, I10 |
| Q-15 | Hard | I | Real replay `a -> wait(1000) -> b`; interrupt after `a`'s durable result but before explicit wait expiry. | Agent remains running until cancellation settles, explicit timer is cancelled, `b` never reaches ToolRuntime, durable state is cancelled/aborted rather than completed, and cleanup is idempotent. | I3, I8, I10 |
| Q-16 | Hard | I | Session A waits between `a` and `b`; session B runs `x -> y`. Deliver B's result to A's pending id, then deliver A's real result. | Cross-session/stale result is rejected diagnostically and cannot advance A; B's cursor/timer and A's wait remain independent, then A advances only on its matching result. | I9, I10 |
| Q-17 | Hard | U | Valid `a -> b` queue receives a duplicate result for `a` after `a` already advanced, then a result for expected `b`. | Duplicate/stale result produces the required terminal protocol diagnostic and does not consume `b`; the queue never advances on the stale result or emits a later call from it. | I7, I8, I9 |
| Q-18 | Hard | I | Full replay `a -> parallel[b,c] -> d` where all results succeed, followed by final summary/stop; inspect invocation and durable event order. | `d` starts only after both parallel results and its edge wait; final stop is emitted once after `d`'s durable result, wait steps are absent from tool events, and successful cleanup leaves no plan/timer/listener. | I3, I5, I6, I8, I10 |

## Execution notes

- For timing assertions, use `recordingClock`; assert both elapsed duration and
  observer/event order. A parallel group's member completion order may differ,
  but its membership and barrier must be deterministic.
- For integration cases, assert the registered fixture sees the invocation and
  the adapter does not directly call an implementation. Preserve normal DSH
  error codes, tool cards, and durable results.
- For conversion failures, assert the source line/path and conflicting field
  diagnostics, no canonical plan/queue, and no tool call. For replay failures
  and overwrite tests, take a source snapshot before and after the operation.
