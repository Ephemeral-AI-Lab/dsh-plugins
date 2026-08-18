# DSH debug-agent test report

Date: 2026-08-17 (Asia/Shanghai)

Scope: external plugin at
`C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\debug-agent`, loaded by
the unmodified DSH web host at
`C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness`.

## Executive result

The plugin-local and real-runtime gates pass. The browser smoke check passes
against a freshly rebuilt plugin and host:

- plugin typecheck: PASS;
- plugin unit/integration suite: **53/53 PASS** across 8 files;
- plugin build: PASS;
- DSH host web build: PASS;
- external session fixture replay: **7/7 executable steps** through the real
  AgentLoop and ToolRuntime;
- compact UI smoke: PASS; the final assistant message is a one-line summary
  and the status row is `1/1` or `7/7`.

The requested host debug-agent E2E target is not present in the host checkout:

```text
apps/web/tests/debug-agent.e2e.ts  -> False
apps/web/tests/debug-agent.web.ts  -> False
```

Therefore the host E2E result is recorded as blocked/not applicable rather
than silently treated as a plugin failure.

## UI diagnosis

The noisy UI was caused by the plugin, not by a DSH web rendering defect.

The plugin was copying complete tool-result bodies into its final assistant
summary while DSH web was also correctly rendering the authoritative normal
tool/result card. That produced duplicate output. The adapter now emits only:

```text
Debug run/replay completed (N executable step[s]).
```

The normal DSH tool-call, tool-result, and error cards remain authoritative.
The final rebuilt browser check showed compact tool-call rows, the one-line
completion message, and the compact `7/7` status row; it did not show a full
result body in the assistant summary. This matches
`ui/ui-ux.md`: no invented result transcript and no second large debug panel.

The host web build itself completed successfully, and no DSH web source was
changed. The unrelated host E2E failures below do not explain the observed
duplicate UI output.

## Fixes implemented

1. Reassembled interleaved packed and assistant JSONL chunks by source order,
   supporting both `seq` and `seq0`. Conflicting complete representations are
   still rejected.
2. Removed result-body aggregation from the adapter's final response.
3. Added cancellation cleanup for explicit waits, live tool execution,
   pre-start fixture loading, result handoff, disposal, and early-aborted
   streams.
4. Added run-identity guards so a late result or late cancellation from a
   retired run cannot clear or revive a replacement run.
5. Added deterministic `DEBUG_PROTOCOL` handling for wrong, duplicate,
   unknown, stale, mismatched, and cross-session result correlations.
6. Restored the complete real LLM route configuration after debug turns,
   including provider/model and request options such as temperature,
   maxTokens, stop, and reasoning settings.
7. Kept auxiliary calls on the real host route so title/compaction-style calls
   cannot consume a pending debug tool result.
8. Preserved durable lifecycle/status behavior for pre-start failures and
   stale persisted active state.

## Commands and evidence

All commands below were run after the fixes were applied.

| Command | Result |
| --- | --- |
| `pnpm typecheck` in the plugin | PASS |
| `pnpm test` in the plugin | PASS, 8 files, 53 tests |
| `pnpm build` in the plugin | PASS |
| `pnpm build` in `deepseek-harness` | PASS; web Vite build completed |
| `/debug run exec_command({"cmd":"Write-Output UI_FINAL_COMPACT"})` | PASS; 1/1, compact output |
| `/debug replay <extracted session.jsonl> --overwrite-wait-time-ms 0` | PASS; 7/7 |

The supplied ZIP was preserved read-only. Evidence hashes:

```text
ZIP:
3A6052CA1CFE50E63B88FF1923853FAACDF0FF05F1B9469611E5D865E36810EA

Extracted JSONL:
0008E8413FA56A09C6100771CBBC83CCF4B80E8B5EE42E2A54066723B0039573
```

The extracted fixture converted to 13 canonical records, 6 waits, 7
top-level executable steps, and 14 tool-call members including parallel
members. The replay source was not rewritten.

## Failing-before-passing evidence

The first browser replay of the supplied fixture stopped at a conversion
mismatch around source line 241 because packed and assistant fragments were
being assembled in representation-group order rather than source order. The
converter regression now reproduces that external interleaving and passes.

The first browser run also exposed the UI duplication: the final response
contained the full result body in addition to the normal DSH result card. The
final-response regression now asserts completion-only text and explicitly
rejects result-body text in the assistant summary.

## Automated coverage disposition

The 53 passing tests cover the applicable local implementation surface:

- parser and invalid-command behavior;
- canonical validation, waits, parallel steps, CRLF, packed chunks, trailing
  deltas, multiple calls, and the supplied external fixture shape;
- real AgentLoop/ToolRuntime execution and preservation of native
  `UNKNOWN_TOOL` and `INVALID_ARGS` errors;
- result correlation, duplicate/stale/late/cross-session results, disposal,
  replacement runs, cancellation, and timer/wait cleanup;
- real-provider routing and complete route restoration;
- durable pre-start failure projection and run-ordered UI projection;
- accessibility copy for waiting and terminal status states.

The test plan contains broader host-dependent cases for policy/approval,
background jobs, nested agents, session reload in the compiled browser, and
concurrent web sessions. Those require host E2E fixtures that are not present
in this checkout; they are not represented as passing plugin-local tests.

## Host E2E gate

The documented commands were invoked exactly:

```text
pnpm test:e2e -- apps/web/tests/debug-agent.e2e.ts
pnpm test:web -- apps/web/tests/debug-agent.e2e.ts
```

The first command did not select a debug-agent file because that file does not
exist and ran the broader host E2E suite. It exited 1 with:

```text
Test Files  4 failed | 23 passed | 33 skipped (60)
Tests       9 failed | 98 passed | 90 skipped (197)
```

The failures were unrelated host-environment/baseline failures, including
missing `typescript-language-server`, Windows symlink `EPERM`, ACP connection
startup, and shipped web-agent-preset expectations. The second command built
the host successfully, then exited 1 with:

```text
No test files found, exiting with code 1
filter: apps/web/tests/debug-agent.e2e.ts
```

The `90 skipped` and `33 skipped` counters belong to that broad host-suite
run, not to debug-agent: `90` is skipped test cases, while `33` is skipped
test files. The host E2E configuration includes package/CLI E2E files, not
`apps/web/tests`, and many of those suites intentionally skip when
prerequisites are unavailable, such as real-provider credentials,
platform-specific capabilities, or built artifacts. One visible example was
the LSP E2E file with four skipped cases. The missing debug-agent file itself
contributed no passing or skipped debug-agent tests.

The host working tree remained clean (`## master...origin/master`). No DSH
web source or host test was added or modified by this cycle.

## Final conclusion

The reported “print everything in the UI” behavior was an owned plugin bug and
is fixed. DSH web is rendering the normal authoritative runtime cards as
designed. The remaining host E2E limitation is missing test infrastructure,
plus unrelated host-suite failures; it is not evidence of a DSH web bug in
the debug-agent UI path.
