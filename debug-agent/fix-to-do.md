# Debug Agent Fix-To-Do

Status: **Not approved for acceptance-test/release validation**

The three independent implementation reviews all returned **FAIL**. The happy
path is working, but the items below must be fixed and covered by regression
tests before the implementation receives a test-phase pass.

## Current evidence

- `pnpm typecheck` passes.
- `pnpm build` passes.
- `pnpm test` passes: 6 files, 35 tests.
- The extracted fixture JSONL converts to 7 executable replay steps.
- A fresh browser session completed the fixture replay through `7/7`.
- The debug path uses the real `AgentLoop` and `ToolRuntime`; the adapter emits
  model chunks and does not execute tools directly.

## P0 — release blockers

### FIX-01: Make cancellation clean up the active replay plan

Problem: cancelling while a real tool is executing can leave the plan in
memory. The next ordinary user turn may then be routed to `mock-debug`.

Required work:

- Clean up the plan on ordinary agent cancellation, not only on disposal.
- Abort and wake every result-waiting loop owned by the session.
- Check the replay request signal before and after asynchronous fixture loading.
- Ensure a cancelled load cannot create a new plan after cancellation.
- Restore the normal provider route on completion, error, and cancellation.

Regression tests:

- Cancel during real ToolRuntime execution, then send a normal user turn.
- Cancel during an explicit wait.
- Cancel while the fixture is still loading.
- Deliver a late tool result after cancellation and verify it is ignored or
  reported as a protocol error without reviving the plan.

Acceptance criteria: zero plans, timers, listeners, and debug provider routes
remain after cancellation.

### FIX-02: Reject invalid tool-result correlation instead of waiting forever

Problem: unknown, stale, duplicate, mismatched, and cross-session result IDs
are silently ignored. The adapter then waits indefinitely for a result that
cannot arrive.

Required work:

- Distinguish valid historical results from malformed current results.
- Validate the result ID against the currently expected call ID.
- Validate `tool-result.toolCallId` against the originating tool call.
- Detect duplicate results rather than overwriting the first result.
- Detect cross-session results.
- Return a structured `DEBUG_PROTOCOL` failure with useful IDs and session
  context.

Regression tests:

- Unknown result ID.
- Stale result from a previous replay run.
- Duplicate result for the same call.
- Mismatched `toolCallId`.
- Result belonging to another session.
- Valid historical result that must not be treated as a current replay result.

Acceptance criteria: no malformed result can leave the adapter pending
indefinitely; every invalid case terminates with a deterministic diagnostic.

### FIX-03: Make session teardown and plan replacement wake old generators

Problem: `clearSession()` removes the plan but does not wake an existing
`waitForReportedResults()` loop. Re-entering the same session can also allow an
old generator to delete or overwrite the replacement plan.

Required work:

- Give each plan a cancellation controller or equivalent wake mechanism.
- Abort the old plan before installing a replacement.
- Guard terminal cleanup with the plan/run identity that created it.
- Prevent old UI events from overwriting a newer run in the same session.

Regression tests:

- Clear a session while it waits for a tool result.
- Start a replacement replay before the old replay receives its result.
- Deliver the old result after replacement.
- Run two independent sessions concurrently.
- Dispose the plugin while sessions are waiting.

Acceptance criteria: old streams terminate, new plans remain intact, and no
session has state owned by another run.

### FIX-04: Prevent stale persisted UI state after reload

Problem: persisted `running`/`waiting` state can reappear after reload even
though no live adapter plan exists. A stale run can also overwrite a newer run
because UI state is keyed only by session ID.

Required work:

- On startup/reload, reconcile persisted active state with live in-memory plans.
- Mark orphaned active state terminal/stale instead of presenting it as live.
- Apply `runId` checks to every state update, not only disposal.
- Ensure a newer run cannot be overwritten by an older event.

Regression tests:

- Reload after a waiting replay is interrupted.
- Restart the host after a failed replay.
- Start two runs in the same session in quick succession.
- Confirm the browser never displays an orphaned active progress row.

Acceptance criteria: reload either resumes a deliberately supported run or
shows it as stopped/stale; it never presents an inactive run as live.

### FIX-05: Persist pre-start failures into the session projection

Problem: parse, load, and validation failures update memory and emit a context
event, but do not append a session event. The browser therefore cannot render
the failure state reliably.

Required work:

- Append a `debug/status` failure event for errors before the replay starts.
- Use the same error shape for parse, load, validation, runtime, and protocol
  failures.
- Preserve line/record diagnostics where available.

Regression tests:

- Missing fixture path.
- Malformed JSONL.
- Invalid script/schema.
- Invalid output path or policy failure.
- Browser assertion that the failure is visible in the session UI.

Acceptance criteria: every replay failure produces one durable, visible error
state and does not leave the session looking active.

## P1 — correctness and compatibility

### FIX-06: Restore the complete real LLM route

Problem: restoration currently copies only provider and model. Other route
fields, such as reasoning configuration, may be lost or inherit debug values.

Required work:

- Snapshot the complete `LlmCallConfig` before entering debug mode.
- Restore the complete snapshot on success, error, cancellation, and disposal.
- Keep debug mode slash-command-driven; do not expose a deterministic debug
  model selector.
- Do not mutate or replace the system prompt.

Regression tests:

- Preserve provider, model, reasoning settings, and other route fields.
- Verify the next normal turn uses the original route.
- Assert no explicit deterministic debug model appears in the model catalog.
- Assert no plugin-owned system-prompt update is emitted.

### FIX-07: Complete chunk/record mismatch detection

Problem: packed chunks and trailing deltas convert correctly in normal cases,
but conflicting packed and complete assistant records can be silently
discarded instead of producing `CONVERSION_MISMATCH`.

Required work:

- Compare complete assistant calls with reconstructed packed/chunk calls.
- Reject conflicting tool IDs, names, arguments, or ordering.
- Keep incomplete trailing deltas as explicit conversion errors with source
  line/record diagnostics.
- Cover CRLF and multi-record JSONL inputs.

Regression tests:

- Complete call plus identical packed chunks: accepted.
- Complete call plus conflicting chunks: `CONVERSION_MISMATCH`.
- Incomplete chunk sequence: conversion failure with diagnostics.
- Multiple calls and parallel calls reconstructed from chunks.

### FIX-08: Decide and implement ZIP input support

Problem: the referenced ZIP contains `session.jsonl`, but replay currently
reads only JSON/JSONL paths directly. Extracted JSONL works; direct ZIP replay
does not.

Required work:

- Either implement safe direct ZIP replay for the supported archive shape, or
  explicitly reject ZIP input with a clear extraction instruction.
- Document the chosen behavior in the CLI and test plan.
- Add a fixture-based test using:
  `C:\Users\yifan\Downloads\dsh-session-session-bada1bd3-0a37-417b-bbdf-2c9b5844967f.zip`

Acceptance criteria: ZIP behavior is intentional, documented, and tested;
there is no ambiguous UTF-8 parse failure.

### FIX-09: Test auxiliary calls through the real host path

Problem: the auxiliary-call bypass is covered with a mocked fallback, but not
with real session-title or compaction calls while a replay is pending.

Required work:

- Verify `purpose: session-title` and `purpose: compaction` bypass replay
  cursor/result consumption.
- Verify they use the saved real provider route.
- Verify they cannot block or advance the debug replay.

Regression tests:

- Session-title call during a pending tool result.
- Compaction call during a pending tool result.
- Auxiliary call after cancellation.

### FIX-10: Make package/profile resolution reproducible

Problem: local profile testing required a junction because the host profile did
not have an installed `dsh-debug-agent` package.

Required work:

- Document the supported plugin installation/linking procedure.
- Test package-name resolution from a clean profile setup.
- Keep the host checkout source tree unmodified.
- Verify both node and `./client` exports through the installed package.

Acceptance criteria: a clean test profile loads the plugin by package name
without an ad-hoc workaround that is absent from the documented setup.

## P2 — UI and test completeness

### FIX-11: Improve progress and terminal accessibility

Required work:

- Show a visible waiting label or spinner while waiting for a tool result.
- Keep current step and total progress visible in waiting and failed states.
- Announce completion, cancellation, and failure instead of rendering terminal
  states as an immediate empty/null view.
- Preserve the accessible `progressbar` semantics for active replay.

Regression tests:

- Running, waiting, pending approval, failed, cancelled, and completed UI
  states.
- Keyboard/screen-reader accessible status text and progress values.

### FIX-12: Add browser/profile E2E coverage

Add E2E coverage for:

- `/debug` slash-command registration.
- No explicit deterministic debug model selector.
- No system-prompt update row owned by the plugin.
- Real tool execution and durable tool-call/result correlation.
- Progress row placement above the composer.
- Waiting state while the tool is still running.
- Completion at `7/7` for the external fixture.
- Invalid-script failure rendering.
- Reload/reconnect and stale-state cleanup.
- Concurrent sessions and session isolation.
- Plugin disposal and provider restoration.

## Verification gate

Do not mark the implementation ready for acceptance testing until all P0 items
are fixed and covered by tests.

Required commands:

```powershell
Set-Location C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\debug-agent
pnpm typecheck
pnpm build
pnpm test
```

Then run the host browser/profile tests with the documented clean profile
installation. Record skipped cases and prerequisites explicitly. The final
report must demonstrate:

- zero owned plans/timers/listeners after completion, cancellation, error, and
  disposal;
- invalid result IDs terminate deterministically;
- replay replacement cannot corrupt newer state;
- reload cannot resurrect an inactive run;
- the external fixture completes through `7/7`;
- normal turns still use the configured real provider/model;
- the host source checkout remains unmodified.
