# Loop E2E test prompts

These prompts are designed for an agent or test harness with access to the
real Loop plugin, `CommandRuntime`, session persistence, agent lifecycle, and
fake-clock controls. Run each block independently against a fresh disposable
session. Use the Loop feature's normal actions to set, view, and remove
recurring alarms for setup and cleanup; do not replace a scenario with direct
state mutation or a single unit-test shortcut.

Describe alarm creation as a natural user request. For example: “Set a
recurring alarm to ask yourself to check the code every 10 seconds.”

For every scenario, report the exact command/tool calls, session and alarm IDs,
observed heartbeats, persistence results, cleanup actions, and any unexpected
behavior. Wait for projection and persistence state to converge before making
assertions about later timers or resumed agents.

End every scenario with exactly one final verdict line:

```text
Verdict: PASS
```

or

```text
Verdict: FAIL
```

Use `Verdict: FAIL` if any assertion is unmet, output is missing or duplicated,
the wrong session or route receives a heartbeat, cleanup does not converge, a
loop can be resurrected, or any unexpected behavior occurs. Do not report a
scenario as passed merely because the test process completed.

Every scenario follows this cleanup contract:

1. Create a fresh disposable profile and session.
2. View the recurring alarms currently scheduled in the session.
3. Remove every returned alarm through the Loop feature's normal remove action.
4. Wait for the alarm list and projection state to become empty.
5. Run the scenario.
6. Remove every remaining alarm through the normal Loop feature action.
7. Wait for projected emptiness.
8. Dispose the runtime.
9. Advance or wait one additional interval and confirm no heartbeat appears.

## 1. Smoke: one-second idle delivery and deletion

```text
Run the one-second idle delivery and deletion E2E test.

1. Create a fresh disposable session at fake time 0.
2. View the scheduled recurring alarms and remove every existing alarm through
   the Loop feature. Wait for projected state to become empty.
3. Set a recurring alarm to ask yourself `LOOP_E2E_IDLE` every 1 second, then
   advance to the first due boundary.
4. Verify exactly one heartbeat arrives in the session inbox, contains
   LOOP_E2E_IDLE, uses the Loop plugin source, targets the idle agent's
   next-turn path, and has wakeup=true.
5. Remove the alarm using its returned ID, advance one more interval, and
   verify that no further heartbeat arrives.
6. Remove any remaining alarms, wait for projected emptiness, dispose the
   runtime, and report the cleanup result.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## 2. Smoke: running-agent delivery

```text
Run the running-agent delivery E2E test.

1. Create a fresh disposable session at fake time 0. View the scheduled alarms
   and remove any existing alarms by ID through the Loop feature.
2. Set a recurring alarm to ask yourself `LOOP_E2E_RUNNING` every 1 second.
3. Start a deterministic model or tool operation that remains running across
   the one-second due boundary.
4. Verify the heartbeat is admitted through the running-agent next-step path
   with wakeup=true and does not interrupt the current operation.
5. Release the operation, observe processing, and remove the alarm using its
   returned ID.
6. Wait for projected emptiness, dispose the runtime, and report the operation
   state, heartbeat route, alarm ID, and cleanup result.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## 3. Smoke: same-deadline ordering

```text
Run the same-deadline ordering E2E test.

1. Create a fresh disposable session at fake time 0. View the scheduled alarms
   and remove all existing alarms by ID through the Loop feature.
2. Set one recurring alarm to ask yourself `LOOP_E2E_FIRST` every 1 second,
   then set a second alarm to ask yourself `LOOP_E2E_SECOND` every 1 second.
3. Advance to the first due boundary and inspect the session inbox.
4. Verify both heartbeats arrive exactly once and in creation/event-fold order.
5. Remove both alarms, advance one more interval, and verify no additional
   messages arrive.
6. Wait for projected emptiness, dispose the runtime, and report both alarm IDs,
   the observed heartbeat order, and final state.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## 4. Smoke: dispose and resume

```text
Run the dispose-and-resume E2E test.

1. Create a fresh disposable session at fake time 0. View the scheduled alarms
   and remove all existing alarms by ID through the Loop feature.
2. Set a recurring alarm to ask yourself `LOOP_E2E_RESUME` every 1 second.
3. Dispose or stop the agent before the due boundary.
4. Resume the same session with a replacement agent and wait for one heartbeat.
5. Verify only the replacement agent receives the heartbeat.
6. Remove the alarm, verify no later delivery occurs, wait for projected
   emptiness, dispose the runtime, and report both agent/session identities, the
   alarm ID, heartbeat recipient, and cleanup result.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## 5. Smoke: session isolation

```text
Run the session-isolation E2E test.

1. Create two fresh disposable sessions at fake time 0. View the scheduled
   alarms and remove all existing alarms by ID in both sessions.
2. In session A set a recurring alarm to ask yourself `LOOP_E2E_A` every
   1 second.
3. In session B set a recurring alarm to ask yourself `LOOP_E2E_B` every
   1 second.
4. At the due boundary, verify session A receives only A's heartbeat and
   session B receives only B's heartbeat.
5. Remove alarm A, leave alarm B active for one more interval, and verify B
   continues while A stays silent.
6. Clean both sessions, wait for projected emptiness, dispose both runtimes,
   and report session IDs, alarm IDs, received prompts, and cleanup state.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## 6. Hard: delete versus due-drive race

```text
Run the delete-versus-due-drive race E2E test.

1. Create a fresh disposable session at fake time 0. View the scheduled alarms
   and remove all existing alarms by ID through the Loop feature.
2. Set a recurring alarm to ask yourself `HARD_RACE_TARGET` every 1 second.
3. Block the runtime's pre-fold persistence flush.
4. At the due boundary, concurrently request the runtime drive and remove the
   target alarm by ID through the real Loop feature runtime.
5. Release the queue and let all pending work settle.
6. Verify the final durable state has no active target alarm, no heartbeat was
   sent for a removed alarm, and no later timer can resurrect it.
7. Set a second recurring alarm to ask yourself `HARD_RACE_CONTROL` every
   1 second, and prove a normal alarm still delivers once. Remove the control
   alarm by ID, clean up, dispose the runtime, and report the ordering,
   persistence outcome, and heartbeat results.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## 7. Hard: post-dispatch persistence failure and recovery

```text
Run the post-dispatch persistence failure and recovery E2E test.

1. Create a fresh disposable session at fake time 0. View the scheduled alarms
   and remove all existing alarms by ID through the Loop feature.
2. Set a recurring alarm to ask yourself `HARD_RECOVERY` every 1 second.
3. At the due boundary, allow Agent.send() to succeed, append the dispatch
   event, and make only the post-dispatch session flush fail.
4. Verify the failure is observable and no successful durable completion is
   reported.
5. Recover persistence and request another drive. Verify the same due
   occurrence is not sent a second time.
6. Advance to the next occurrence and verify exactly one new heartbeat with a
   strictly greater next_at.
7. Dispose and resume the same session once more to prove the recovered durable
   state reconstructs correctly. Clean up, dispose the runtime, and report the
   failure, dispatch events, IDs, recovery result, and final state.

Report the calls and the final verdict. End with exactly one final line:
`Verdict: PASS` or `Verdict: FAIL`.
```

## Execution order

Run the supporting test floor before the prompt-driven scenarios:

1. Domain, reducer, parser, and projection tests
2. Real Cordis, Session, ToolRuntime, and CommandRuntime integration
3. Runtime ordering, failure, and race tests
4. UI boundary and flicker tests
5. Typecheck and build/import checks
6. Five smoke E2E tests
7. Two hard E2E tests

The current automated runner is
`test/e2e.test.ts`; the original scenario fixtures remain under
`test/e2e/prompts/` because the runner validates their scenario markers.
