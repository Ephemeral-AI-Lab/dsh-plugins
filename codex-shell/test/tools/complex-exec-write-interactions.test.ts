import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('complex exec_command and write_stdin interactions', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let owner: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    owner = harness.agent('complex-owner')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('completes one interactive session across three ordered calls', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:ordered', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const partial = await callTool(harness.writeStdin, {
      session_id: sessionId,
      chars: 'PA',
      yield_time_ms: 0,
    }, execution(owner))
    const completed = await callTool(harness.writeStdin, {
      session_id: sessionId,
      chars: 'SS\n',
      yield_time_ms: 1_000,
    }, execution(owner))

    expect(partial.value?.session_id).toBe(sessionId)
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS ordered'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('interleaves partial input on two sessions before finishing either one', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:first-interleave', yield_time_ms: 0 }, execution(owner))
    const second = await callTool(harness.execCommand, { cmd: 'interactive:second-interleave', yield_time_ms: 0 }, execution(owner))
    const firstId = first.value!.session_id!
    const secondId = second.value!.session_id!
    const firstPartial = await callTool(harness.writeStdin, { session_id: firstId, chars: 'PA', yield_time_ms: 0 }, execution(owner))
    const secondPartial = await callTool(harness.writeStdin, { session_id: secondId, chars: 'PA', yield_time_ms: 0 }, execution(owner))
    const firstDone = await callTool(harness.writeStdin, { session_id: firstId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner))
    const secondDone = await callTool(harness.writeStdin, { session_id: secondId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner))

    expect(firstPartial.value?.session_id).toBe(firstId)
    expect(secondPartial.value?.session_id).toBe(secondId)
    expect(firstDone.value).toMatchObject({ output: expect.stringContaining('PASS first-interleave'), exit_code: 0 })
    expect(secondDone.value).toMatchObject({ output: expect.stringContaining('PASS second-interleave'), exit_code: 0 })
  })

  it('keeps concurrent foreground successes and a nonzero exit associated', async () => {
    const results = await Promise.all([
      callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(owner)),
      callTool(harness.execCommand, { cmd: 'fail', yield_time_ms: 1_000 }, execution(owner)),
      callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(owner)),
    ])

    expect(results.map(result => result.value?.exit_code)).toEqual([0, 1, 0])
    expect(results[0]?.value?.output).toContain('PASS foreground')
    expect(results[1]?.value?.output).toContain('FAIL simulated command')
    expect(results[2]?.value?.output).toContain('PASS foreground')
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('serializes concurrent writes that split one command across a queue', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:write-queue', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const [partial, completed] = await Promise.all([
      callTool(harness.writeStdin, { session_id: sessionId, chars: 'PA', yield_time_ms: 0 }, execution(owner)),
      callTool(harness.writeStdin, { session_id: sessionId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner)),
    ])

    expect(partial.value?.session_id).toBe(sessionId)
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS write-queue'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('runs concurrent queued writes on separate sessions without cross-delivery', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:queue-one', yield_time_ms: 0 }, execution(owner))
    const second = await callTool(harness.execCommand, { cmd: 'interactive:queue-two', yield_time_ms: 0 }, execution(owner))
    const firstId = first.value!.session_id!
    const secondId = second.value!.session_id!
    const [firstPartial, secondPartial] = await Promise.all([
      callTool(harness.writeStdin, { session_id: firstId, chars: 'PA', yield_time_ms: 0 }, execution(owner)),
      callTool(harness.writeStdin, { session_id: secondId, chars: 'PA', yield_time_ms: 0 }, execution(owner)),
    ])
    const [firstDone, secondDone] = await Promise.all([
      callTool(harness.writeStdin, { session_id: firstId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner)),
      callTool(harness.writeStdin, { session_id: secondId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner)),
    ])

    expect(firstPartial.value?.session_id).toBe(firstId)
    expect(secondPartial.value?.session_id).toBe(secondId)
    expect(firstDone.value).toMatchObject({ output: expect.stringContaining('PASS queue-one'), exit_code: 0 })
    expect(secondDone.value).toMatchObject({ output: expect.stringContaining('PASS queue-two'), exit_code: 0 })
  })

  it('rejects a foreign write, then lets the original owner finish the session', async () => {
    const other = harness.agent('foreign-owner')
    const started = await callTool(harness.execCommand, { cmd: 'interactive:ownership-retry', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const foreign = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(other))
    const partial = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'PA', yield_time_ms: 0 }, execution(owner))
    const completed = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner))

    expect(foreign.isError).toBe(true)
    expect(foreign.content[0]?.text).toContain('belongs to a different agent owner')
    expect(partial.value?.session_id).toBe(sessionId)
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS ownership-retry'), exit_code: 0 })
  })

  it('keeps a session owned after a foreign poll and accepts the owner write', async () => {
    const other = harness.agent('polling-foreigner')
    const started = await callTool(harness.execCommand, { cmd: 'interactive:ownership-poll', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const foreignPoll = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 0 }, execution(other))
    const completed = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(owner))

    expect(foreignPoll.isError).toBe(true)
    expect(foreignPoll.content[0]?.text).toContain('belongs to a different agent owner')
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS ownership-poll'), exit_code: 0 })
  })

  it('cleans one owner while another owner completes its independent session', async () => {
    const other = harness.agent('surviving-owner')
    const owned = await callTool(harness.execCommand, { cmd: 'interactive:cleaned-owner', yield_time_ms: 0 }, execution(owner))
    const surviving = await callTool(harness.execCommand, { cmd: 'interactive:surviving-owner', yield_time_ms: 0 }, execution(other))
    const ownedId = owned.value!.session_id!
    const survivingId = surviving.value!.session_id!

    await owner.cleanup!()
    expect(harness.service.liveSessionCount).toBe(1)

    const survivingDone = await callTool(harness.writeStdin, { session_id: survivingId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(other))
    const cleanedWrite = await callTool(harness.writeStdin, { session_id: ownedId, chars: '', yield_time_ms: 0 }, execution(owner))

    expect(survivingDone.value).toMatchObject({ output: expect.stringContaining('PASS surviving-owner'), exit_code: 0 })
    expect(cleanedWrite.isError).toBe(true)
    expect(harness.service.liveSessionCount).toBe(0)
    expect(cleanedWrite.content[0]?.text).toContain('unknown or completed')
  })

  it('races owner cleanup with delayed polls and preserves the other owner session', async () => {
    const other = harness.agent('cleanup-race-survivor')
    const owned = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-race-owned', yield_time_ms: 0 }, execution(owner))
    const surviving = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-race-survivor', yield_time_ms: 0 }, execution(other))
    const ownedId = owned.value!.session_id!
    const survivingId = surviving.value!.session_id!
    const ownedPoll = callTool(harness.writeStdin, { session_id: ownedId, chars: '', yield_time_ms: 100 }, execution(owner))
    const survivingPoll = callTool(harness.writeStdin, { session_id: survivingId, chars: '', yield_time_ms: 100 }, execution(other))

    await new Promise<void>(resolve => setTimeout(resolve, 10))
    await owner.cleanup!()
    const [ownedResult, survivingResult] = await Promise.all([ownedPoll, survivingPoll])
    const survivingDone = await callTool(harness.writeStdin, { session_id: survivingId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(other))
    const cleanedWrite = await callTool(harness.writeStdin, { session_id: ownedId, chars: '', yield_time_ms: 0 }, execution(owner))

    expect(ownedResult.isError || ownedResult.value?.exit_code).toBeTruthy()
    expect(survivingResult.value?.session_id).toBe(survivingId)
    expect(survivingDone.value).toMatchObject({ output: expect.stringContaining('PASS cleanup-race-survivor'), exit_code: 0 })
    expect(cleanedWrite.isError).toBe(true)
  })

  it('uses a zero-wait poll before collecting delayed output from a slow command', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const immediate = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 0 }, execution(owner))
    const delayed = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 1_000 }, execution(owner))

    expect(immediate.value?.session_id).toBe(sessionId)
    expect(immediate.value?.exit_code).toBeUndefined()
    expect(delayed.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
  })

  it('keeps delayed output available while an interleaved foreground command exits', async () => {
    const slow = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(owner))
    const foreground = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(owner))
    const sessionId = slow.value!.session_id!
    const immediate = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 0 }, execution(owner))
    const delayed = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 1_000 }, execution(owner))

    expect(foreground.value).toMatchObject({ output: expect.stringContaining('PASS foreground'), exit_code: 0 })
    expect(immediate.value?.session_id).toBe(sessionId)
    expect(delayed.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
  })

  it('polls between partial input and the final chunk without losing ownership or output', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:delayed-chunks', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const partial = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'PA', yield_time_ms: 0 }, execution(owner))
    const poll = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 25 }, execution(owner))
    const completed = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'SS\n', yield_time_ms: 1_000 }, execution(owner))

    expect(partial.value?.session_id).toBe(sessionId)
    expect(poll.value?.session_id).toBe(sessionId)
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS delayed-chunks'), exit_code: 0 })
  })

  it('returns a nonzero exit after a failed interactive command is sent in chunks', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:failed-chunks', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const partial = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'FA', yield_time_ms: 0 }, execution(owner))
    const failed = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'IL\n', yield_time_ms: 1_000 }, execution(owner))

    expect(partial.value?.session_id).toBe(sessionId)
    expect(failed.value).toMatchObject({ output: expect.stringContaining('FAIL failed-chunks'), exit_code: 1 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('removes a failed session before a new session starts and rejects stale polling', async () => {
    const failed = await callTool(harness.execCommand, { cmd: 'interactive:stale-failure', yield_time_ms: 0 }, execution(owner))
    const failedId = failed.value!.session_id!
    const failureResult = await callTool(harness.writeStdin, { session_id: failedId, chars: 'FAIL\n', yield_time_ms: 1_000 }, execution(owner))
    const recovered = await callTool(harness.execCommand, { cmd: 'interactive:recovered', yield_time_ms: 0 }, execution(owner))
    const recoveredResult = await callTool(harness.writeStdin, {
      session_id: recovered.value!.session_id!,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(owner))
    const stalePoll = await callTool(harness.writeStdin, { session_id: failedId, chars: '', yield_time_ms: 0 }, execution(owner))

    expect(failureResult.value?.exit_code).toBe(1)
    expect(recoveredResult.value).toMatchObject({ output: expect.stringContaining('PASS recovered'), exit_code: 0 })
    expect(stalePoll.isError).toBe(true)
    expect(stalePoll.content[0]?.text).toContain('unknown or completed')
  })

  it('does not let a pre-aborted write destroy a still-live session', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:pre-abort', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const foreground = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(owner))
    const controller = new AbortController()
    controller.abort()
    const abortedWrite = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'PASS\n', yield_time_ms: 1_000 }, { agent: owner, signal: controller.signal })
    expect(harness.service.liveSessionCount).toBe(1)
    const completed = await callTool(harness.writeStdin, { session_id: sessionId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(owner))

    expect(foreground.value?.exit_code).toBe(0)
    expect(abortedWrite.isError).toBe(true)
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS pre-abort'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('aborts a delayed poll and removes the session before a stale follow-up', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const foreground = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(owner))
    const controller = new AbortController()
    const pendingPoll = callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 1_000 }, { agent: owner, signal: controller.signal })

    await new Promise<void>(resolve => setTimeout(resolve, 10))
    controller.abort()
    const abortedPoll = await pendingPoll
    const stalePoll = await callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 0 }, execution(owner))

    expect(foreground.value?.exit_code).toBe(0)
    expect(abortedPoll.isError).toBe(true)
    expect(stalePoll.isError).toBe(true)
    expect(stalePoll.content[0]?.text).toContain('unknown or completed')
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('aborts the first queued operation and rejects a completion queued behind it', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:abort-queue', yield_time_ms: 0 }, execution(owner))
    const sessionId = started.value!.session_id!
    const controller = new AbortController()
    const pendingPoll = callTool(harness.writeStdin, { session_id: sessionId, chars: '', yield_time_ms: 1_000 }, { agent: owner, signal: controller.signal })

    await new Promise<void>(resolve => setTimeout(resolve, 10))
    const queuedCompletion = callTool(harness.writeStdin, { session_id: sessionId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(owner))
    controller.abort()
    const [abortedPoll, completion] = await Promise.all([pendingPoll, queuedCompletion])

    expect(abortedPoll.isError).toBe(true)
    expect(completion.isError).toBe(true)
    expect(completion.content[0]?.text).toContain('unknown or completed')
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('disposes multiple live sessions while their polls are waiting', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:dispose-one', yield_time_ms: 0 }, execution(owner))
    const second = await callTool(harness.execCommand, { cmd: 'interactive:dispose-two', yield_time_ms: 0 }, execution(owner))
    const firstId = first.value!.session_id!
    const secondId = second.value!.session_id!
    const firstPoll = callTool(harness.writeStdin, { session_id: firstId, chars: '', yield_time_ms: 1_000 }, execution(owner))
    const secondPoll = callTool(harness.writeStdin, { session_id: secondId, chars: '', yield_time_ms: 1_000 }, execution(owner))

    await new Promise<void>(resolve => setTimeout(resolve, 10))
    await harness.service.dispose()
    const [firstResult, secondResult] = await Promise.all([firstPoll, secondPoll])
    const staleFirst = await callTool(harness.writeStdin, { session_id: firstId, chars: '', yield_time_ms: 0 }, execution(owner))
    const postDisposeExec = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(owner))

    expect(firstResult.isError || firstResult.value?.exit_code).toBeTruthy()
    expect(secondResult.isError || secondResult.value?.exit_code).toBeTruthy()
    expect(staleFirst.isError).toBe(true)
    expect(postDisposeExec.isError).toBe(true)
    expect(postDisposeExec.content[0]?.text).toContain('session service is disposed')
  })

  it('keeps concurrent interactive success and failure results tied to their owners', async () => {
    const other = harness.agent('concurrent-other')
    const success = await callTool(harness.execCommand, { cmd: 'interactive:concurrent-success', yield_time_ms: 0 }, execution(owner))
    const failure = await callTool(harness.execCommand, { cmd: 'interactive:concurrent-failure', yield_time_ms: 0 }, execution(other))
    const successId = success.value!.session_id!
    const failureId = failure.value!.session_id!
    const [successResult, failureResult] = await Promise.all([
      callTool(harness.writeStdin, { session_id: successId, chars: 'PASS\n', yield_time_ms: 1_000 }, execution(owner)),
      callTool(harness.writeStdin, { session_id: failureId, chars: 'FAIL\n', yield_time_ms: 1_000 }, execution(other)),
    ])

    expect(successResult.value).toMatchObject({ output: expect.stringContaining('PASS concurrent-success'), exit_code: 0 })
    expect(failureResult.value).toMatchObject({ output: expect.stringContaining('FAIL concurrent-failure'), exit_code: 1 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('makes repeated owner cleanup calls idempotent across partially written sessions', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-repeat-one', yield_time_ms: 0 }, execution(owner))
    const second = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-repeat-two', yield_time_ms: 0 }, execution(owner))
    const firstId = first.value!.session_id!
    const secondId = second.value!.session_id!
    const firstPartial = await callTool(harness.writeStdin, { session_id: firstId, chars: 'PA', yield_time_ms: 0 }, execution(owner))
    const secondPartial = await callTool(harness.writeStdin, { session_id: secondId, chars: 'PA', yield_time_ms: 0 }, execution(owner))

    await Promise.all([owner.cleanup!(), owner.cleanup!()])
    const firstAfterCleanup = await callTool(harness.writeStdin, { session_id: firstId, chars: 'SS\n', yield_time_ms: 0 }, execution(owner))
    const secondAfterCleanup = await callTool(harness.writeStdin, { session_id: secondId, chars: 'SS\n', yield_time_ms: 0 }, execution(owner))

    expect(firstPartial.value?.session_id).toBe(firstId)
    expect(secondPartial.value?.session_id).toBe(secondId)
    expect(firstAfterCleanup.isError).toBe(true)
    expect(secondAfterCleanup.isError).toBe(true)
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
