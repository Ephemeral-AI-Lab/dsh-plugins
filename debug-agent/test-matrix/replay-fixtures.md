# Canonical replay fixtures

Bounded read-only review of DSH session/JSONL fixtures for the `debug-agent`
backend. The source tree below was inspected but not modified.

```text
DSH source: C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness
Plugin:     C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\debug-agent
```

These are canonical `dsh-debug-script` bodies, not ACP `input.json` wrappers or
provider replay-override files. Run them through the real DSH `AgentLoop` and
`ToolRuntime` for integration checks; use `streamHarness`/`recordingClock` for
fast adapter and timing checks. The named tools are the deterministic fixtures
from `test-matrix/05-08-runtime.md`.

Materialized JSON files for the quick smoke suite are in
[replay-fixtures/](replay-fixtures/README.md). The examples below explain the
coverage; the files are the inputs to use in automated replay tests.

## 1. Source cases and useful patterns

| Source case/path | Pattern found | Useful replay/converter behavior |
| --- | --- | --- |
| `examples/acp-agent/tests/snapshots/parallel-tool-calls/{input.json,session.jsonl,stdout.expected.jsonl}` | One assistant step emits two sibling `read` calls (`a.txt`, `b.txt`), finishes with `tool-calls`, then receives two durable `tool/result` records before a second step returns `DONE`. | Group sibling calls from one assistant message into one `parallel` step; retain array order; wait for the group barrier; do not derive a wait between siblings. Use `ordered_tool` instead of filesystem reads in custom smoke fixtures. |
| `examples/acp-agent/tests/snapshots/tool-call-turn/session.jsonl` | Minimal complete tool-call turn: assistant call block, durable `tool/call`, durable `tool/result`, final assistant text, `turn/end`. | Good oracle for the authoritative event sequence of RF-01. Historical result content is evidence, not a fresh replay result. |
| `examples/acp-agent/tests/snapshots/cancel-tool-calls/{input.json,replay.override.json,session.jsonl}` | One response contains a long-running `bash` call and a second call; cancellation records `ABORTED` for the dispatched call and `ABORTED_BEFORE_DISPATCH` for the skipped call, then an aborted `turn/end`. | Cancellation must stop later work and preserve DSH error payloads. Do not copy the hanging shell or file-writing commands; RF-05 uses a short canonical wait and harmless probes. |
| `examples/acp-agent/tests/snapshots/background-job-admission/{input.json,replay.override.json,session.jsonl}` | Several result-dependent model responses: start a background task, attempt a second task, kill the first, check a side effect, then stop with a deterministic summary. | Demonstrates multi-step fail-fast/result-boundary behavior and durable job results. The source uses `while :; do sleep 60; done` and filesystem side effects, so it is source-pattern evidence only, not a quick-smoke input. |
| `examples/acp-agent/tests/snapshots/error-finish/{replay.override.json,session.jsonl}` | Provider-level `finish` error with `AUTH`, followed by `turn/end` with `reason.kind=error`; no tool result is synthesized. | Keep provider errors distinct from runtime `UNKNOWN_TOOL`, `INVALID_ARGS`, and execution errors. The canonical error variants below exercise the real ToolRuntime path instead. |
| `examples/headless-agent/tests/snapshots/ralph-loop/{session.jsonl,session.1.jsonl,session.2.jsonl,replay.override.json}` | Parent session plus numbered child sessions with `parentSession`; child logs contain their own tool-call chunks. | `session.N.jsonl` is a session boundary, not an extra sequential step in the parent. A converter must preserve or explicitly reject child scope; it must not flatten child calls/results into the parent replay. |
| `examples/headless-agent/tests/snapshots/subagent-settlement/{parent.replay.jsonl,child.replay.jsonl,child.expected.jsonl}` | Parent and child replay files are separate; the child has `delegationDepth:1` and a final text response. | Confirms the nested/subagent ambiguity. Apply the matrix’s `UNSUPPORTED_NESTED_TOOL`/exclude-child policy rather than claiming deterministic parent replay. |
| `packages/test-support/acp-snapshot/tests/harness.spec.ts` (`promptAndCancel`, `waitForTurnEnd`, `waitForInboxMessage`) and `packages/test-support/acp-snapshot/tests/fixtures/fake-acp-agent.ts` | A parked turn is made durable before cancellation; cancellation may persist `turn/end` or an inbox insertion, and the harness waits for that durable boundary. | Use durable event gates, not presentation timing. This supports RF-05 and RF-06 assertions that cancellation/reload settles the session and does not replay old results. |
| `apps/web/tests/live-interactions.e2e.ts` and `apps/web/tests/snapshots/live-interactions/{session.jsonl,cancel.expected.md}` | A ready-file gate parks a stream before stop; the durable final reason is `aborted` and the UI returns to idle. | Useful cancellation ordering oracle, but intentionally not part of this smoke plan because browser sessions are out of scope for this review. |

The source `replay.override.json` files are arrays of `{ "kind": "chunks" }`
entries. They are useful to understand emitted chunks, but they are not DSH
session JSONL and should not be mistaken for canonical debug scripts.

## 2. Custom canonical replay scripts

All scripts use only harmless deterministic matrix fixtures. `probe_tool` records
exact arguments and returns success; `ordered_tool` can use a recording clock;
`throws_tool` fails intentionally; `needs_value` and `not_registered` exercise
the real runtime’s validation/lookup errors. No script depends on an LLM,
network, shell process, background job, filesystem mutation, or browser.

### RF-01 — single probe and durable success (`RTI-01`, `ASTR-01`)

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "smoke" } }
  ]
}
```

Expected: one complete tool-call block, one real `tool/call`, one real
`tool/result`, one final assistant stop/message, and terminal idle. The tool
implementation is entered only by `ToolRuntime`.

### RF-02 — parallel barrier followed by a short explicit wait (`RTI-04`, `Q-08`, `Q-18`)

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    {
      "parallel": [
        { "tool": "ordered_tool", "args": { "label": "left", "delayMs": 20 } },
        { "tool": "ordered_tool", "args": { "label": "right", "delayMs": 10 } }
      ]
    },
    { "wait": 200 },
    { "tool": "probe_tool", "args": { "value": "after-parallel" } }
  ]
}
```

Expected: both siblings are emitted in one assistant response, with no
inter-member wait; either sibling may finish first; `probe_tool` is not emitted
until both results are durable and the 200 ms edge wait has elapsed. The
parallel group counts as one executable step.

### RF-03 — explicit wait plus default wait (`Q-04`, `Q-06`, `Q-13`)

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "first" } },
    { "wait": 150 },
    { "tool": "ordered_tool", "args": { "label": "middle", "delayMs": 0 } },
    { "tool": "probe_tool", "args": { "value": "last" } }
  ]
}
```

Expected schedule: `first --150 ms--> middle --100 ms default--> last`.
The wait is scheduling state only: it emits no tool call, result, progress
step, or fake event.

### RF-04 — fail-fast runtime error variants (`RTI-05`, `RTI-06`, `RTI-07`, `Q-10`)

Run each small variant as an isolated script. The final probe must never run.

Controlled execution error:

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "before-error" } },
    { "tool": "throws_tool", "args": { "message": "fixture failure" } },
    { "tool": "probe_tool", "args": { "value": "must-not-run" } }
  ]
}
```

Unknown tool:

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "not_registered", "args": {} },
    { "tool": "probe_tool", "args": { "value": "must-not-run" } }
  ]
}
```

Invalid arguments (canonical shape is valid; the real tool schema must reject
it):

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "needs_value", "args": {} },
    { "tool": "probe_tool", "args": { "value": "must-not-run" } }
  ]
}
```

Expected: preserve the real DSH error/result (`EXECUTION_ERROR` or the host’s
normal execution code, `UNKNOWN_TOOL`, or `INVALID_ARGS`), record the failing
tool/result, emit no later top-level call, and settle idle. The adapter does not
pre-validate, pre-approve, or execute any fixture.

### RF-05 — cancellation during an explicit wait (`ASTR-10`, `RTE-05`, `RTE-12`)

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "started" } },
    { "wait": 250 },
    { "tool": "probe_tool", "args": { "value": "must-not-run" } }
  ]
}
```

After the first result is durable, abort while the 250 ms timer is pending.
Expected: no second call, no fake wait/tool event, an aborted/cancelled normal
DSH settlement, and zero owned timers/listeners/plans after cleanup. Letting the
timer expire is a separate non-cancellation control and is not needed for the
quick smoke.

### RF-06 — durable reload without re-execution (`RTI-15`, `C-12`, `C-16`)

```json
{
  "type": "dsh-debug-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "persisted-first" } },
    { "wait": 100 },
    { "tool": "probe_tool", "args": { "value": "persisted-second" } }
  ]
}
```

Complete the turn through `recordingSessionStore`, then close/reload the
session. Expected: the two current tool calls/results and final assistant event
reload with their durable order, while the fixture invocation count remains
unchanged. Historical `tool/result` content is never fed back as a new model
result or a new tool call.

## 3. Wait normalization and overwrite behavior

- The default edge gap is **100 ms** whenever two executable top-level steps
  have no explicit wait.
- Explicit waits in this catalog are **100, 150, 200, or 250 ms**. They occur
  only after the preceding tool/group results and before the next executable
  step. No wait is first, last, consecutive, or inside a parallel group.
- There are no LLM inference delays. The mock adapter emits complete calls and
  one immediate deterministic final text response. `ordered_tool`’s 10/20 ms
  values are deterministic fixture work, not model pacing; unit tests should
  use `recordingClock` rather than sleeping.
- `--overwrite-wait-time-ms N` replaces **explicit waits only** in the detached
  in-memory canonical plan. For example, RF-03 with `--overwrite-wait-time-ms
  100` changes 150 to 100, while its omitted edge remains the 100 ms default;
  RF-05’s 250 becomes 100. It does not rewrite the source JSONL/JSON, create a
  converted sidecar, or change the default gap. Verify source bytes and last
  write metadata before/after an overwrite run.

## 4. Expected duration and quick-smoke budget

These are planning estimates for one already-booted process. The first number
is scripted logical delay; the range includes small deterministic tool/runtime
overhead but excludes package installation and host startup.

| Fixture | Scripted delay exercised | Expected active duration | Notes |
| --- | ---: | ---: | --- |
| RF-01 | 0 ms | 20–100 ms | One fast probe and final stop. |
| RF-02 | 200 ms | 220–350 ms | Parallel work is bounded by the 20 ms sibling; no inter-member gap. |
| RF-03 | 250 ms | 270–380 ms | 150 ms explicit edge plus one 100 ms default edge. |
| RF-04 family | 0–100 ms | 20–220 ms | The controlled-error variant has one preceding default edge; first-step lookup/schema failures are faster. |
| RF-05 | about 100 ms until abort | 100–180 ms | Cancel before the 250 ms wait expires; a full-expiry control would be about 250–350 ms. |
| RF-06 | 100 ms | 130–260 ms | Reload/read adds no tool execution and should be below 50 ms in the isolated store. |

Quick smoke target: approximately **750 ms of logical waits**, about
**1.5–1.8 s active runtime**, and a **3 s single-process backend budget** with
normal setup/teardown. This is a planning budget only; no tests, builds,
servers, LLM calls, or browser sessions were run during this review.

## 5. Converter tests required for source-format ambiguity

The following cases should be added before treating DSH JSONL replay as stable.
They are converter tests, not extra smoke scripts.

1. **Sibling grouping and historical results:** Convert the
   `parallel-tool-calls/session.jsonl` shape. The two calls from one
   `assistant/message` become one `parallel` step in message-array order;
   interleaved `tool/call` and `tool/result` records do not split the group or
   become replay inputs. This is `C-02`, `C-04`, and `C-16`.
2. **Complete-vs-delta duplicates:** The source often has
   `assistant/chunk` `tool-call-delta`, a complete `block-end`, and an
   `assistant/message` for the same call. Prefer one complete representation;
   conflicting name/id/arguments must raise `CONVERSION_MISMATCH`, not silently
   fall back or duplicate a call (`C-09`, `C-11`).
3. **Override-file detection:** `replay.override.json` is an array of
   `{kind:"chunks",chunks:[...]}` records, not DSH JSONL and not canonical
   `dsh-debug-script` JSON. The detector must select a separate documented
   adapter or reject it clearly; it must not reinterpret chunk records as
   executable steps.
4. **Child-session scope:** `session.1.jsonl`, `session.2.jsonl`,
   `parentSession`, and `delegationDepth` identify separate child sessions.
   Test the `ralph-loop` and `subagent-settlement` shapes for explicit
   exclude-child or `UNSUPPORTED_NESTED_TOOL` behavior (`JOB-09`).
5. **Timestamp ambiguity:** Some records have `time:0`, some have wall-clock
   values, and packed records use `time0`/`dt`; source units and boundaries are
   not uniformly comparable. Only a known unit with a reliable top-level
   `turn/step` boundary may produce an explicit wait. Otherwise produce no
   timing-derived wait and retain the 100 ms default (`C-07`, `C-08`, `Q-02`).
6. **Empty/header-only sessions:** `ralph-loop/session.jsonl` contains only a
   session header. It must not be combined with `replay.override.json` by
   filename convention or treated as a successful no-op; the converter should
   report the documented empty/invalid-script outcome.
7. **Cancellation records are evidence:** The
   `cancel-tool-calls/session.jsonl` `ABORTED` and
   `ABORTED_BEFORE_DISPATCH` results must remain diagnostics for the source
   run. They must not be replayed as current results, and the source call ids
   must not be reused as live ids.

The source-format tests should assert 1-based path/line diagnostics, one shared
canonical validator for all adapters, no tool invocation on conversion failure,
and byte-for-byte preservation of the input under overwrite and failure paths.
