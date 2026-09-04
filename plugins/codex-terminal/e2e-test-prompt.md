# E2E test prompts

These prompts are designed for an agent with access to `exec_command` and
`write_stdin`. Run each block independently against the installed plugin. Use
the tools themselves for every command and poll; do not replace the scenario
with a single shell script.

For every scenario, report the exact tool calls, returned `job_id` values,
output, exit codes, and any unexpected behavior. If a call returns a
`job_id`, continue with `write_stdin` until the job reaches its
documented terminal state.

## 1. Smoke: trivial command

```text
Run a basic exec_command smoke test.

1. Call exec_command with `node -e "console.log('SMOKE-OK')"`, a yield_time_ms of 1000, and a generous output limit.
2. Verify the result contains exactly `SMOKE-OK`, has exit_code 0, and does not leave an unexplained job.
3. If a job_id is returned, poll it once with write_stdin using chars="" and verify the final result is clean.

Report the calls and the final verdict. This is a latency and basic-output check; do not add extra commands.
```

## 2. Smoke: nonzero exit code

```text
Verify that exec_command preserves a command's nonzero exit status.

1. Call exec_command with `node -e "console.error('EXPECTED-FAIL'); process.exit(7)"`.
2. Verify `EXPECTED-FAIL` is visible and the final result reports exit_code 7 rather than treating the command as a tool failure.
3. If a job_id is returned, use write_stdin with chars="" until the terminal result is available.

Do not retry the command or hide the nonzero exit. Report whether output and exit_code were both preserved.
```

## 3. Smoke: stdin round trip

```text
Verify that a pipe-backed job accepts stdin through write_stdin.

1. Start this command with exec_command and a short yield: `node -e "process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { console.log('ECHO:' + d.trim()); process.exit(0) })"`.
2. If exec_command returns a job_id, call write_stdin with chars="hello-from-stdin\n".
3. Verify the output contains exactly `ECHO:hello-from-stdin`, the final exit_code is 0, and the job can be collected normally.

Use write_stdin for the input; do not pass the input through the command string or an intermediate file.
```

## 4. Smoke: delayed output between calls

```text
Verify that output produced after exec_command returns is retained for the next poll.

1. Call exec_command with `node -e "setTimeout(() => console.log('DELAYED-OUTPUT'), 250)"` and yield_time_ms=0.
2. Wait briefly without replacing the job with another command.
3. Poll the returned job_id with write_stdin using chars="".
4. Verify `DELAYED-OUTPUT` appears in the poll result and the final exit_code is 0.

The key assertion is that output emitted between exec_command and write_stdin is neither lost nor duplicated.
```

## 5. Smoke: natural exit and notification flow

```text
Exercise a command that exits naturally after exec_command has returned.

1. Start `node -e "setTimeout(() => { console.log('NATURAL-EXIT'); process.exit(0) }, 200)"` with yield_time_ms=0.
2. If the initial result returns a job_id, stop issuing tools and let natural completion steer the agent.
3. Verify exactly one owner notification tells the agent to call write_stdin with the same job_id and empty chars.
4. Call write_stdin(chars="") and verify the result exposes `NATURAL-EXIT` and exit_code 0.
5. Poll once more and verify the completed job reports that no unread output remains without repeating `NATURAL-EXIT`.

Do not assume that process exit means the session can be discarded before its output is read.
```

Repeat this scenario with write_stdin already waiting when the process exits. That call must
return the terminal output and exit code without a second background completion notice.

## 6. Longer: token-capped output pagination

```text
Test the completed-session output pagination path.

1. Start this command with exec_command and yield_time_ms=0: `node -e "for (let i = 0; i < 160; i++) console.log('LINE-' + i)"`.
2. Once the job_id is available, call write_stdin with chars="" and max_output_tokens=100.
3. Treat a capped result as an intermediate page even if it already contains exit_code 0. Continue polling the same job with empty chars and the same output limit until job_id disappears.
4. Concatenate all returned output and assert every line LINE-0 through LINE-159 appears exactly once, in order.
5. Assert the final result has exit_code 0 and that a further poll reports `no unread output remains` without duplicating output.

This is a data-retention test. A mid-line cutoff in one page is acceptable only when the next poll recovers the complete remainder; silently missing or duplicated lines is a failure.
```

## 7. Longer: multi-step interactive session

```text
Exercise several write_stdin calls against one live process.

1. Start this command with exec_command and a short yield: `node -e "process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { for (const line of d.split(/\r?\n/)) { if (!line) continue; console.log('ACK:' + line); if (line === 'quit') process.exit(0) } })"`.
2. Send `first\n` with write_stdin and verify `ACK:first`.
3. Send `second\n` with write_stdin and verify `ACK:second`; confirm the first response is not replayed.
4. Send `quit\n` with write_stdin and collect the terminal result.
5. Verify the final exit_code is 0, `ACK:quit` is present, and no later empty poll duplicates earlier output.

Keep the same job_id for all calls. Record whether each call returned promptly after new output or process exit.
```

## 8. Longer: concurrent sessions and cleanup

```text
Test independent sessions, round-robin polling, natural completion, and cleanup.

1. Start four commands with separate exec_command calls:
   - `node -e "setTimeout(() => console.log('JOB-A'), 100)"`
   - `node -e "setTimeout(() => console.log('JOB-B'), 250)"`
   - `node -e "setTimeout(() => { console.error('JOB-C'); process.exit(3) }, 150)"`
   - `node -e "setTimeout(() => console.log('JOB-D'), 350)"`
   Use yield_time_ms=0 so they exercise session polling.
2. Poll the four job_ids in round-robin order with write_stdin(chars=""), allowing each session to finish independently.
3. Verify each job's output and exit code: A/B/D exit 0, C exits 3 with its stderr visible.
4. Do not poll one job through another job_id, and do not assume completion order matches start order.
5. After all terminal results are collected, verify job_list reports terminal states and repeated empty polls return no unread output.

The test passes only if output and exit status stay associated with the correct session and completed sessions are eventually released.
```
