# loop test matrix

This document is the release test matrix for the `loop` plugin. It is a test
target, not a claim that every scenario is already implemented.

## Test-count target

| Layer | Scenario range | Count | Runtime target |
| --- | --- | ---: | --- |
| Domain validation, time math, heartbeat formatting | `D01–D20` | 20 | ≤150 ms each |
| Event folding and projections | `E01–E20` | 20 | ≤150 ms each |
| Tool and command boundaries | `B01–B24` | 24 | ≤500 ms each |
| Runtime, timers, delivery, ordering | `R01–R28` | 28 | ≤750 ms each |
| Lifecycle, concurrency, isolation, reliability | `L01–L16` | 16 | ≤1 s each |
| UI dock and client behavior | `U01–U24` | 24 | ≤500 ms each |
| Static, packaging, offline, release checks | `S01–S08` | 8 | ≤10 s each |
| **Automated target** |  | **140** |  |
| E2E smoke | `SM01–SM05` | 5 | 3–9 s each |
| E2E hard/race/recovery | `HD01–HD02` | 2 | 2–6 s each |
| **Total planned scenarios** |  | **147** |  |

The audit baseline was 76 existing automated tests. That number is the current
test count, while 140 is the desired count of distinct behavior scenarios;
parameterized cases may produce more individual `it()` blocks.

## Test rules

1. Use real DSH, Cordis, `Session`, `ToolRuntime`, `CommandRuntime`, and
   `AgentRegistry` boundaries wherever the boundary is available.
2. Use a fake Agent/model. Scheduler correctness must not depend on a real
   provider response.
3. Use fake timers for all recurring-loop tests. No unit or integration test
   may wait for more than 10 seconds of wall-clock time.
4. Advance to explicit boundaries. Do not use `runAllTimersAsync()` with a
   recurring loop because it can run forever.
5. Assert observable contracts: exact inbox message, delivery target,
   `wakeup: true`, event order, persisted `next_at`, and cleanup.
6. Normal `loop/change` events are durable and must not be marked ignorable.
7. A failed send must not append a dispatch. A post-dispatch persistence
   failure must be observable and must not create a duplicate occurrence during
   recovery.
8. Every E2E case starts with an empty disposable session and ends by deleting
   all loops, proving the projection is empty, and disposing the runtime.

## Files

### Existing test files to extend

| File | Responsibility |
| --- | --- |
| `test/loop.test.ts` | Pure loop validation, time math, event reducer, heartbeat XML |
| `test/projection.test.ts` | Durable-log projection, legacy compatibility, validation parity |
| `test/commands.test.ts` | `/loop` parser and command boundary |
| `test/plugin.integration.test.ts` | Real plugin, Agent, Session, ToolRuntime, and timer integration |
| `test/preflight.test.ts` | Runtime event registration and package compatibility |
| `test/ui.test.tsx` | UI rendering, CRUD states, countdown, and flicker boundaries |
| `test/client-entry.test.ts` | Client entry/build/export contract |

### Smallest new files

Create these only when the existing fixtures cannot express the boundary:

```text
test/persistence.integration.test.ts
test/e2e/prompts/SM01-one-second-idle.md
test/e2e/prompts/SM02-running-agent.md
test/e2e/prompts/SM03-same-deadline-order.md
test/e2e/prompts/SM04-dispose-and-resume.md
test/e2e/prompts/SM05-session-isolation.md
test/e2e/prompts/HD01-delete-drive-race.md
test/e2e/prompts/HD02-post-dispatch-recovery.md
```

`test/persistence.integration.test.ts` is the release-blocking addition. It
must use a real persistence round trip: create → flush → dispose/detach →
prepare/load the same session → replay `loop/change` → restore the timer.

## Automated scenario matrix

### D — domain validation, time math, and heartbeat formatting (20)

| ID | Scenario |
| --- | --- |
| D01 | Create a loop with a trimmed prompt and a positive safe-integer interval. |
| D02 | Reject zero, negative, fractional, `NaN`, infinite, string, and missing intervals. |
| D03 | Reject an empty or whitespace-only prompt. |
| D04 | Preserve prompt text after command parsing, including internal spaces. |
| D05 | Compute `next_at = now + seconds × 1000` at a known clock value. |
| D06 | Reject timestamps that are not finite safe integers. |
| D07 | Reject interval arithmetic that overflows `Number.MAX_SAFE_INTEGER`. |
| D08 | Accept the one-second minimum and calculate its exact due boundary. |
| D09 | Accept a large valid interval without timer arithmetic drift. |
| D10 | Escape `&` in heartbeat XML. |
| D11 | Escape `<` and `>` in heartbeat XML. |
| D12 | Escape quotes and apostrophes in heartbeat XML. |
| D13 | Preserve the loop ID in the heartbeat body. |
| D14 | Preserve the prompt in the heartbeat body after escaping. |
| D15 | Emit the exact `<heartbeat>` envelope and required fields only. |
| D16 | Advance a missed loop to the first strictly future occurrence. |
| D17 | Do not replay every missed interval as a burst. |
| D18 | Keep equal-deadline insertion order stable. |
| D19 | Compare different deadlines numerically rather than lexically. |
| D20 | Verify heartbeat generation is pure and does not mutate the loop record. |

### E — event folding and projections (20)

| ID | Scenario |
| --- | --- |
| E01 | Fold a create event into one active loop. |
| E02 | Fold a dispatch event and advance `next_at`. |
| E03 | Fold a delete event and remove the loop. |
| E04 | Fold create → dispatch → delete to an empty projection. |
| E05 | Ignore unrelated session events. |
| E06 | Apply only events after `seedLength` at a fork boundary. |
| E07 | Preserve event-fold order for same-deadline loops. |
| E08 | Reject unsupported event versions. |
| E09 | Reject unknown event operations such as `rename`. |
| E10 | Reject malformed event shapes and missing required fields. |
| E11 | Reject invalid loop IDs. |
| E12 | Reject invalid prompts and intervals during replay. |
| E13 | Reject invalid or non-increasing dispatch `next_at`. |
| E14 | Reject duplicate active creates in the authoritative reducer. |
| E15 | Reject update/delete/dispatch of inactive loops where the reducer requires it. |
| E16 | Apply legacy `title` and `allow_steer` fields without leaking them into current state. |
| E17 | Verify projection and strict reducer agree on malformed histories. |
| E18 | Verify projection replay is stable when the same valid log is folded twice. |
| E19 | Verify delete then recreate with the same ID follows the documented policy. |
| E20 | Verify a persisted fork resumes with only the post-seed loop state. |

### B — tool and command boundaries (24)

| ID | Scenario |
| --- | --- |
| B01 | Expose exactly `loop_create`, `loop_list`, and `loop_delete` to the root agent. |
| B02 | Do not expose loop tools to a child agent when the contract forbids it. |
| B03 | Reject unknown tool input fields. |
| B04 | Reject invalid interval values before appending an event. |
| B05 | Reject empty prompts before appending an event. |
| B06 | Create through the real `ToolRuntime` and return the persisted loop record. |
| B07 | List active loops from the real session projection. |
| B08 | Delete an existing loop through the real `ToolRuntime`. |
| B09 | Reject deletion of an unknown loop ID. |
| B10 | Keep create and delete session-scoped. |
| B11 | Assert create ordering: validation → append → flush → result. |
| B12 | Assert delete ordering: validation → append → flush → result. |
| B13 | Return an error when the create flush throws. |
| B14 | Return an error when the create flush reports failure. |
| B15 | Do not claim create success after failed persistence. |
| B16 | Parse `/loop list` through the real command runtime. |
| B17 | Parse `/loop delete <id>` through the real command runtime. |
| B18 | Parse `/loop <seconds> <prompt>` through the real command runtime. |
| B19 | Preserve the complete prompt remainder, including spaces and punctuation. |
| B20 | Reject `/loop` with no operation or prompt. |
| B21 | Reject unsupported create/update JSON forms. |
| B22 | Confirm command and tool paths produce the same event/view shape. |
| B23 | Confirm command errors are user-visible and do not mutate session state. |
| B24 | Confirm the command surface contains no title, steer, follow-up, or update API. |

### R — runtime, timers, delivery, and ordering (28)

| ID | Scenario |
| --- | --- |
| R01 | At 999 ms of a one-second interval, send zero heartbeats. |
| R02 | At exactly 1,000 ms, send exactly one heartbeat. |
| R03 | At 1,001 ms, still send only the due occurrence once. |
| R04 | Send the exact plugin inbox message with the heartbeat body. |
| R05 | Send with `wakeup: true`. |
| R06 | Use `next-turn` while the agent is idle. |
| R07 | Use `next-step` while the agent is actively running. |
| R08 | Select the delivery target from agent status at dispatch time. |
| R09 | Never call steer or follow-up delivery methods. |
| R10 | Deliver two loops independently in one session. |
| R11 | Deliver three or more loops without cross-targeting. |
| R12 | Deliver equal-deadline loops in creation/event-fold order. |
| R13 | Deliver different-deadline loops in numeric due-time order. |
| R14 | Catch up a late loop once and schedule the first future occurrence. |
| R15 | Do not burst-send all missed occurrences. |
| R16 | Coalesce multiple `requestDrive()` calls while a drive is blocked. |
| R17 | Ignore timer callbacks that arrive during an active drive until serialization permits them. |
| R18 | Delete-before-due prevents the heartbeat and timer work. |
| R19 | Re-arm after a successful dispatch with strictly greater `next_at`. |
| R20 | Clamp delays that exceed the platform timeout limit and preserve the remainder. |
| R21 | Do not create a false dispatch after initial persistence failure. |
| R22 | Do not create a dispatch after `Agent.send()` throws. |
| R23 | Surface post-dispatch flush failure after send succeeds. |
| R24 | Recover from post-dispatch failure without duplicating the same occurrence. |
| R25 | Preserve exact command ID, call ID, current agent, and abort signal. |
| R26 | Keep a second loop healthy when the first loop delivery fails. |
| R27 | Prevent overlapping sends when two due callbacks race. |
| R28 | Ensure each dispatch is persisted before the next occurrence is eligible. |

### L — lifecycle, concurrency, isolation, and reliability (16)

| ID | Scenario |
| --- | --- |
| L01 | Dispose the runtime before due time and prevent later sends. |
| L02 | Dispose while persistence is in flight. |
| L03 | Late timer callbacks after disposal cannot revive the runtime. |
| L04 | Remove the exact agent from `AgentRegistry` while persistence is pending. |
| L05 | Stop delivery when the registry no longer contains the runtime agent. |
| L06 | Dispose agent A and resume the same session with replacement agent A2. |
| L07 | Ensure stale agent A cannot send after A2 takes ownership. |
| L08 | Reconstruct timers from persisted storage rather than an old timer handle. |
| L09 | Persisted create → dispose → reload restores an active loop. |
| L10 | Persisted dispatch → dispose → reload uses the advanced `next_at`. |
| L11 | Concurrent creates do not cross-target IDs. |
| L12 | Concurrent deletes do not delete the wrong loop. |
| L13 | Session A cannot list or delete Session B loops. |
| L14 | Session B continues after Session A is disposed. |
| L15 | A failed loop does not corrupt unrelated session events. |
| L16 | Plugin disposal removes tools, timers, listeners, and runtime registry entries. |

### U — UI dock and client behavior (24)

| ID | Scenario |
| --- | --- |
| U01 | Render the empty state with zero loops. |
| U02 | Render one scheduled loop with interval and countdown. |
| U03 | Render multiple loops without reordering on repaint. |
| U04 | Render overdue state after `next_at`. |
| U05 | Render second, minute, and hour intervals correctly. |
| U06 | Render long prompts without breaking the layout. |
| U07 | Render missing session metadata safely. |
| U08 | Render the create control with the simple seconds + prompt contract. |
| U09 | Render delete confirmation. |
| U10 | Cancel delete without issuing a command. |
| U11 | Disable duplicate delete actions while deletion is pending. |
| U12 | Keep the row visible when deletion fails. |
| U13 | Show deletion errors to the user. |
| U14 | Close delete flow after projected removal. |
| U15 | Keep focus usable after opening and closing controls. |
| U16 | Verify accessible names and keyboard activation for controls. |
| U17 | At `next_at - 1 ms`, show the correct one-second countdown. |
| U18 | At exact due time, transition to the documented due state. |
| U19 | After due time, show overdue/catch-up state without backend mutation. |
| U20 | Countdown repaint does not call commands, tools, or Agent methods. |
| U21 | 1 ms/999 ms/1 s repaint increments do not remove or reorder rows. |
| U22 | Outside click collapses only when the pointer is outside the dock. |
| U23 | Escape closes an open dock/menu without mutating loops. |
| U24 | If `ui.md` is authoritative: 0 loops hides the dock, 1–2 show rows, and 3+ uses a collapsed summary with expansion. |

### S — static, packaging, offline, and release checks (8)

| ID | Scenario |
| --- | --- |
| S01 | Runtime event registration is present before the first persistence prepare/load. |
| S02 | The exact persistence catalog used by replay accepts `loop/change`. |
| S03 | Unknown non-ignorable events fail; ignorable unknown events are skipped. |
| S04 | Normal emitted `loop/change` events do not set `ignorable`. |
| S05 | Host TypeScript typecheck passes. |
| S06 | Client TypeScript typecheck passes. |
| S07 | Package build and compiled host/client imports pass offline. |
| S08 | `git diff --check` passes and no file under `deepseek-harness` changes. |

## Release-blocking persistence test

This is the highest-value missing boundary because live append success does not
prove cold replay compatibility.

```text
1. Create a real disposable session using the real persistence backend.
2. Load the compiled loop plugin before the first prepare/load operation.
3. Create a loop through the real ToolRuntime.
4. Flush and dispose/detach the runtime.
5. Prepare/load the same session through the real persistence coordinator.
6. Assert no SessionFormatUnsupportedError is thrown.
7. Assert the restored log contains loop/change.
8. Fold the restored events from the persisted seed boundary.
9. Assert the loop is active with the expected next_at.
10. Replace the runtime and assert the restored timer is armed.
```

The test must verify registration timing and catalog identity. A compile-time
TypeScript event map is not enough; it does not modify the runtime persistence
catalog. Do not solve this by marking `loop/change` ignorable.

## Exact runtime assertions

For the first heartbeat, inspect all send arguments:

```text
send[0][0] = plugin-created user message
send[0][0].content[0].text = exact <heartbeat>...</heartbeat> body
send[0][1] = 'next-turn' when idle, or 'next-step' when running
send[0][2] = true
agent.steer was not called
agent.followup was not called
```

For a successful dispatch, inspect the durable event log:

```text
loop/change create
loop/change dispatch
dispatch.next_at > previous next_at
```

Failure assertions must distinguish these cases:

| Failure point | Required result |
| --- | --- |
| Initial/pre-fold flush | No send, no dispatch, visible error |
| `Agent.send()` | No dispatch, occurrence remains eligible for documented recovery |
| Post-dispatch flush | Send happened, failure is visible, recovery does not duplicate the admitted occurrence |

## E2E session cleanup contract

Every E2E prompt starts and ends with this sequence:

```text
1. Create a fresh disposable profile and session.
2. Run /loop list.
3. Delete every returned loop through the normal command path.
4. Wait for /loop list to return [] and projection state to converge.
5. Run the scenario.
6. Delete every remaining loop through the normal command path.
7. Wait for projected emptiness.
8. Dispose the runtime.
9. Advance/wait one additional interval and assert no heartbeat appears.
```

## Five smoke E2E prompts

### SM01 — one-second idle loop

```text
Clean the disposable session first. Run /loop list and delete every existing
loop. Create /loop 1 LOOP_E2E_IDLE. Wait for exactly one heartbeat. Inspect
the session inbox and confirm the message contains LOOP_E2E_IDLE, uses the loop
plugin source, targets the idle-agent next-turn path, and has wakeup=true.
Delete the loop, advance one more interval, and confirm no further heartbeat
arrives.
```

Target runtime: 4–6 seconds.

### SM02 — running-agent delivery

```text
Clean the disposable session first. Create /loop 1 LOOP_E2E_RUNNING. Start a
deterministic model/tool operation that remains running across the one-second
due boundary. Confirm the heartbeat is admitted through the running-agent
next-step path with wakeup=true, without interrupting the current operation.
Release the operation, observe processing, then delete the loop.
```

Target runtime: 5–8 seconds.

### SM03 — multiple same-deadline loops

```text
Clean the disposable session first. Create /loop 1 LOOP_E2E_FIRST and then
/loop 1 LOOP_E2E_SECOND. At the first due boundary, inspect the inbox and
confirm both heartbeats arrive exactly once and in creation/event-fold order.
Delete both loops and confirm the next interval produces no additional
messages.
```

Target runtime: 6–9 seconds.

### SM04 — dispose and resume

```text
Clean the disposable session first. Create /loop 1 LOOP_E2E_RESUME. Dispose or
stop the agent before the due boundary. Resume the same session with a
replacement agent and wait for one heartbeat. Confirm only the replacement
agent receives it. Delete the loop and verify no later delivery.
```

Target runtime: 6–9 seconds.

### SM05 — session isolation

```text
Clean both disposable sessions first. In session A create /loop 1 LOOP_E2E_A.
In session B create /loop 1 LOOP_E2E_B. At the due boundary confirm A receives
only A and B receives only B. Delete A, leave B active for one more interval,
and confirm B continues while A stays silent. Clean both sessions before
disposal.
```

Target runtime: 6–9 seconds.

## Two hard E2E prompts

### HD01 — due-boundary delete/drive race

```text
Start with a clean disposable session at fake time 0. Create /loop 1
HARD_RACE_TARGET. Block the runtime's pre-fold persistence flush. At the due
boundary, concurrently request the runtime drive and execute /loop delete
<target-id> through the real CommandRuntime. Release the queue and let all
pending work settle.

Assert that the final durable state has no active target loop, no heartbeat was
sent for a deleted loop, and no later timer can resurrect it. Then create
/loop 1 HARD_RACE_CONTROL and prove a normal loop still delivers once.
```

Target runtime: 2–4 seconds.

### HD02 — post-dispatch persistence failure and recovery

```text
Start with a clean disposable session at fake time 0. Create /loop 1
HARD_RECOVERY. At the due boundary, allow Agent.send() to succeed, append the
dispatch event, and make only the post-dispatch session flush fail. Assert the
failure is observable and no successful durable completion is reported.

Recover persistence and request another drive. Assert the same due occurrence
is not sent a second time. Advance to the next occurrence and assert exactly
one new heartbeat with a strictly greater next_at. Dispose and resume the same
session once more to prove the recovered durable state reconstructs correctly.
```

Target runtime: 3–6 seconds.

## Execution order

Run the test floor in this order:

```text
1. Domain, reducer, parser, and projection tests
2. Real Cordis + Session + ToolRuntime + CommandRuntime integration
3. Runtime ordering, failure, and race tests
4. UI boundary and flicker tests
5. Coverage
6. Typecheck and build/import checks
7. Five smoke E2E tests
8. Two hard E2E tests
9. Final cleanup and diff checks
```

## Checks

Use local binaries if Corepack/pnpm reports
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`:

```bash
node_modules/.bin/vitest run
node_modules/.bin/vitest run --coverage --maxWorkers=1
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/tsc -p tsconfig.client.json --noEmit
node node_modules/tsdown/dist/run.mjs
git diff --check
```

The final report must distinguish:

```text
implemented automated tests
implemented E2E tests
planned but not yet implemented scenarios
exact commands run and their runtimes
```
