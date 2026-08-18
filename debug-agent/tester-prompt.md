# Debug Agent Test-Phase Prompt

You are the test owner for the `dsh-debug-agent` plugin.

Test the implementation as an integrated product through the real AgentLoop,
ToolRuntime, session persistence, profile loader, and browser UI. Do not modify
source code while testing. If a defect is found, record the smallest
reproduction, expected behavior, actual behavior, session ID, run ID, command,
fixture path, and relevant log/event IDs.

## Scope and constraints

- Plugin path:
  `C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\debug-agent`
- Host path:
  `C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness`
- Do not modify files under the host checkout.
- Debug mode is entered only through `/debug`; there must be no explicit
  deterministic debug model selector.
- The plugin must not update or replace the system prompt.
- Direct ZIP replay is intentionally unsupported. Extract `session.jsonl` from
  the ZIP and replay the extracted JSONL file.

## Baseline checks

Run from the plugin directory:

```powershell
Set-Location C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\debug-agent
pnpm typecheck
pnpm test
pnpm build
```

Expected baseline:

- Typecheck succeeds.
- All plugin tests pass.
- Build succeeds and emits both the node package and client bundle.
- No source file under `deepseek-harness` is changed.

## Profile and browser setup

Use a clean test profile that resolves the installed package by name:

```text
dsh-debug-agent
dsh-debug-agent/client
```

Verify that the profile loads the package manifest and client entry point. Do
not rely on an undocumented local file URL or an ad-hoc host source change.

Start the host web app with the debug plugin patch and use a fresh browser
session. If the browser reports a stale runtime connection, refresh/reconnect
before recording a result. Record the exact profile setup and host command.

## Fixture preparation

The external fixture is:

```text
C:\Users\yifan\Downloads\dsh-session-session-bada1bd3-0a37-417b-bbdf-2c9b5844967f.zip
```

Extract its `session.jsonl` to a temporary directory. Do not modify the ZIP or
the source JSONL. The extracted fixture is expected to contain 13 canonical
records and 7 executable replay steps.

## Test cases

### T01 — Slash-command registration

In a new session, type `/debug` and verify the command is offered and can be
submitted.

Expected:

- `/debug run <tool>(<JSON>)` and `/debug replay <path>` are available.
- The command queues a normal user message into AgentLoop.
- No debug model appears in the model-selection UI.

### T02 — Real ToolRuntime execution

Run a safe registered tool through:

```text
/debug run <safe_tool>({...})
```

Expected:

- The plugin emits an assistant tool-call message only.
- Tool lookup, validation, authorization, execution, rendering, and durable
  `tool/call` and `tool/result` events come from the real runtime.
- The tool is executed exactly once.
- The debug route is not left active afterward.

### T03 — Canonical JSON replay

Replay a small canonical JSON file with sequential, parallel, and wait steps.

Expected:

- The canonical shape is accepted:
  `type: dsh-debug-script`, `version: 1`, `steps`.
- Wait steps do not create tool calls or count as executable steps.
- Parallel members execute as one top-level executable step.
- The source file is not modified.

### T04 — External DSH JSONL replay

Run:

```text
/debug replay "<extracted-session.jsonl>" --overwrite-wait-time-ms 0
```

Expected:

- The converter produces 7 executable steps.
- The browser progress reaches `7/7`.
- Every tool result arrives through the real runtime.
- The replay ends with a visible completion message.
- No `missing tool result` error appears after the tool has completed.
- Historical `tool/result` records are not executed again.

### T05 — Chunk and packed-record conversion

Use fixtures containing packed `tool-call-chunks`, trailing assistant deltas,
parallel calls, CRLF line endings, and multiple calls.

Expected:

- Valid chunks reconstruct the correct tool name, ID, arguments, and ordering.
- Incomplete chunks fail before execution with line/record diagnostics.
- Conflicting complete-call and chunk records fail with
  `CONVERSION_MISMATCH`.

### T06 — ZIP behavior

Attempt:

```text
/debug replay "C:\path\to\session.zip"
```

Expected:

- Replay fails immediately with `UNSUPPORTED_ARCHIVE`.
- The diagnostic instructs the user to extract `session.jsonl`.
- The ZIP is never interpreted as UTF-8 JSONL.

### T07 — Progress and waiting UI

Use a tool that takes long enough to observe the intermediate state.

Expected:

- A session-scoped status row appears above the composer.
- Running shows the current step and total.
- Waiting visibly says it is waiting for the tool result.
- The progress element exposes an accessible `progressbar` role and bounded
  values.
- Completion, cancellation, and failure remain announced long enough to be
  observable; they do not silently disappear.

### T08 — Cancellation and cleanup

Cancel during each of these states:

- tool execution;
- explicit wait;
- fixture loading;
- result handoff.

Expected:

- The replay ends as cancelled or aborted, not completed.
- No later tool result revives the cancelled replay.
- The next ordinary user turn uses the configured real provider/model.
- No stale progress row remains after reload.

### T09 — Invalid and malformed input

Test missing files, malformed JSONL, invalid canonical JSON, invalid tool
arguments, illegal wait placement, and unsupported nested/subagent tools.

Expected:

- Failure happens before any tool execution when the source is invalid.
- The browser shows a durable failure state with the error code and message.
- Line/path diagnostics are preserved where available.
- Later steps are not silently executed.

### T10 — Stale and invalid result correlation

Exercise unknown, duplicate, stale, mismatched, and cross-session tool results.

Expected:

- Each invalid result terminates deterministically with `DEBUG_PROTOCOL`.
- No request waits forever for a result that cannot arrive.
- A result from another session cannot advance the current replay.
- A late result after cancellation is ignored or reported as a protocol error,
  but never executes another step.

### T11 — Reload and stale-state recovery

Reload or restart while a replay is `queued`, `running`, or `waiting`.

Expected:

- An inactive replay is not shown as a live run after reload.
- Orphaned persisted state is clearly marked stopped/stale or reconciled to a
  supported resumed run.
- A newer run in the same session cannot be overwritten by an older event.

### T12 — Concurrent session isolation

Run two sessions concurrently with different fixtures or tools.

Expected:

- Each session has independent progress, call IDs, results, and terminal
  state.
- One session cannot consume or satisfy another session's tool result.
- Disposing one session does not cancel the other.

### T13 — Auxiliary calls

Trigger session-title and compaction calls while a replay is waiting for a
tool result.

Expected:

- Auxiliary calls do not consume replay steps or pending tool results.
- They use the saved real provider route.
- The replay cursor and progress remain unchanged.

### T14 — Provider and prompt restoration

After successful, failed, and cancelled debug runs, send an ordinary user
message.

Expected:

- The ordinary turn uses the original configured provider/model and route
  settings.
- No deterministic debug model is exposed in model selection.
- No plugin-owned system-prompt update event or row appears.
- Host-owned context-injection logs may remain, but they must not be mistaken
  for replay steps.

## Evidence to capture

For every test run, record:

1. command and profile setup;
2. plugin typecheck/test/build output;
3. fixture path and SHA-256 if applicable;
4. session ID and debug run ID;
5. browser screenshots or visible status text for progress/failure cases;
6. durable `tool/call`, `tool/result`, and `debug/status` event excerpts;
7. final progress and terminal status;
8. any skipped case and its concrete prerequisite;
9. whether the host checkout remained unmodified.

## Failure threshold

Mark the test phase **FAIL** for any of the following:

- a real tool executes outside ToolRuntime;
- a replay waits indefinitely for an invalid or missing result;
- a stale or cross-session result advances a replay;
- malformed input executes any tool;
- reload presents an inactive replay as live;
- the normal provider/model or system prompt is not restored;
- the external fixture does not complete at `7/7`;
- the browser cannot load `/debug` from a clean package-name profile.

Return a final report with `PASS`, `CONDITIONAL PASS`, or `FAIL`, a table of
test IDs, exact commands run, skipped prerequisites, and defect reproductions.
