import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('medium session cases', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('medium-session-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('polls a live interactive session without sending input', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:polling', yield_time_ms: 25 }, execution(agent))
    const polled = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))

    expect(started.isError).toBe(false)
    expect(polled.isError).toBe(false)
    expect(polled.value?.session_id).toBe(started.value?.session_id)
    expect(polled.value?.exit_code).toBeUndefined()
    expect(harness.service.liveSessionCount).toBe(1)
  })

  it('polls delayed output through process completion', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(started.value?.session_id).toBeTypeOf('number')
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
    expect(completed.value?.session_id).toBeUndefined()
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('advances the output cursor across repeated empty polls', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:cursor-poll', yield_time_ms: 0 }, execution(agent))
    const firstPoll = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 250,
    }, execution(agent))
    const secondPoll = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))

    expect(`${started.value?.output}${firstPoll.value?.output}`).toContain('READY cursor-poll')
    expect(secondPoll.value?.output).not.toContain('READY cursor-poll')
    expect(firstPoll.value?.session_id).toBe(started.value?.session_id)
    expect(secondPoll.value?.session_id).toBe(started.value?.session_id)
  })

  it('returns only new output after a readiness poll completes the session', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:cursor-delta', yield_time_ms: 0 }, execution(agent))
    const ready = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 250,
    }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(`${started.value?.output}${ready.value?.output}`).toContain('READY cursor-delta')
    expect(completed.value?.output).toContain('PASS cursor-delta')
    expect(completed.value?.output).not.toContain('READY cursor-delta')
    expect(completed.value?.exit_code).toBe(0)
  })

  it('accepts multiple input chunks before completing a session', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:chunks', yield_time_ms: 0 }, execution(agent))
    const firstChunk = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PA',
      yield_time_ms: 0,
    }, execution(agent))
    const secondChunk = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'SS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(firstChunk.isError).toBe(false)
    expect(firstChunk.value?.session_id).toBe(started.value?.session_id)
    expect(secondChunk.value).toMatchObject({ output: expect.stringContaining('PASS chunks'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('serializes concurrent input chunks in call order', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:serialized', yield_time_ms: 0 }, execution(agent))
    const firstChunk = callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PA',
      yield_time_ms: 0,
    }, execution(agent))
    const secondChunk = callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'SS\n',
      yield_time_ms: 1_000,
    }, execution(agent))
    const [first, second] = await Promise.all([firstChunk, secondChunk])

    expect(first.isError).toBe(false)
    expect(first.value?.session_id).toBe(started.value?.session_id)
    expect(second.value).toMatchObject({ output: expect.stringContaining('PASS serialized'), exit_code: 0 })
  })

  it('repeats interactive start-send-complete cycles without leaking sessions', async () => {
    const sessionIds: number[] = []

    for (const label of ['cycle-one', 'cycle-two', 'cycle-three']) {
      const started = await callTool(harness.execCommand, { cmd: `interactive:${label}`, yield_time_ms: 0 }, execution(agent))
      const completed = await callTool(harness.writeStdin, {
        session_id: started.value!.session_id,
        chars: 'PASS\n',
        yield_time_ms: 1_000,
      }, execution(agent))
      sessionIds.push(started.value!.session_id!)

      expect(completed.value?.output).toContain(`PASS ${label}`)
      expect(completed.value?.exit_code).toBe(0)
    }

    expect(new Set(sessionIds).size).toBe(3)
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('keeps sequentially started sessions independent until each completes', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:first-sequential', yield_time_ms: 0 }, execution(agent))
    const second = await callTool(harness.execCommand, { cmd: 'interactive:second-sequential', yield_time_ms: 0 }, execution(agent))
    const firstCompleted = await callTool(harness.writeStdin, {
      session_id: first.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(first.value?.session_id).not.toBe(second.value?.session_id)
    expect(firstCompleted.value?.output).toContain('PASS first-sequential')
    expect(harness.service.liveSessionCount).toBe(1)

    const secondCompleted = await callTool(harness.writeStdin, {
      session_id: second.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(secondCompleted.value?.output).toContain('PASS second-sequential')
    expect(secondCompleted.value?.exit_code).toBe(0)
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('preserves a failed interactive completion and removes its session', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:failed-session', yield_time_ms: 0 }, execution(agent))
    const failed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'FAIL\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(failed.isError).toBe(false)
    expect(failed.value).toMatchObject({ output: expect.stringContaining('FAIL failed-session'), exit_code: 1 })
    expect(failed.content[0]?.text).toContain('[exit code: 1]')
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('assigns a new chunk id to each result in one session', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:chunk-ids', yield_time_ms: 0 }, execution(agent))
    const partial = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PA',
      yield_time_ms: 0,
    }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'SS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    const chunkIds = [started.value?.chunk_id, partial.value?.chunk_id, completed.value?.chunk_id]
    expect(chunkIds.every(chunkId => typeof chunkId === 'string')).toBe(true)
    expect(new Set(chunkIds).size).toBe(3)
    expect(completed.value?.exit_code).toBe(0)
  })

  it('owner cleanup closes every session owned by the same agent', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-first', yield_time_ms: 0 }, execution(agent))
    const second = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-second', yield_time_ms: 0 }, execution(agent))

    expect(harness.service.liveSessionCount).toBe(2)
    await agent.cleanup!()

    const firstPoll = await callTool(harness.writeStdin, { session_id: first.value!.session_id, chars: '' }, execution(agent))
    const secondPoll = await callTool(harness.writeStdin, { session_id: second.value!.session_id, chars: '' }, execution(agent))
    expect(harness.service.liveSessionCount).toBe(0)
    expect(firstPoll.isError).toBe(true)
    expect(secondPoll.isError).toBe(true)
  })

  it('owner cleanup leaves another agent session running', async () => {
    const other = harness.agent('other-medium-session-agent')
    const owned = await callTool(harness.execCommand, { cmd: 'interactive:owned-cleanup', yield_time_ms: 0 }, execution(agent))
    const otherSession = await callTool(harness.execCommand, { cmd: 'interactive:other-cleanup', yield_time_ms: 0 }, execution(other))

    await agent.cleanup!()
    expect(harness.service.liveSessionCount).toBe(1)

    const otherCompleted = await callTool(harness.writeStdin, {
      session_id: otherSession.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(other))
    const ownedPoll = await callTool(harness.writeStdin, { session_id: owned.value!.session_id, chars: '' }, execution(agent))

    expect(otherCompleted.value?.exit_code).toBe(0)
    expect(ownedPoll.isError).toBe(true)
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('rejects a foreign owner write without closing the original session', async () => {
    const other = harness.agent('foreign-medium-session-agent')
    const started = await callTool(harness.execCommand, { cmd: 'interactive:foreign-write', yield_time_ms: 0 }, execution(agent))
    const rejected = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(other))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(rejected.isError).toBe(true)
    expect(rejected.content[0]?.text).toContain('different agent owner')
    expect(completed.value?.output).toContain('PASS foreign-write')
    expect(completed.value?.exit_code).toBe(0)
  })

  it('runs owner cleanup twice and then recovers with a new session', async () => {
    const first = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-retry', yield_time_ms: 0 }, execution(agent))
    await agent.cleanup!()
    await agent.cleanup!()

    const second = await callTool(harness.execCommand, { cmd: 'interactive:cleanup-recovered', yield_time_ms: 0 }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: second.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))
    const oldSession = await callTool(harness.writeStdin, { session_id: first.value!.session_id, chars: '' }, execution(agent))

    expect(completed.value?.output).toContain('PASS cleanup-recovered')
    expect(completed.value?.exit_code).toBe(0)
    expect(oldSession.isError).toBe(true)
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('recovers from command validation errors without creating a session', async () => {
    const blank = await callTool(harness.execCommand, { cmd: '   ' }, execution(agent))
    const negativeWait = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: -1 }, execution(agent))
    const valid = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent))

    expect(blank.content[0]?.text).toContain('cmd must be a non-empty string')
    expect(negativeWait.content[0]?.text).toContain('yield_time_ms must be a non-negative finite number')
    expect(valid.value).toMatchObject({ output: expect.stringContaining('PASS foreground'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('recovers from invalid stdin arguments and completes the live session', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:stdin-validation', yield_time_ms: 0 }, execution(agent))
    const invalid = await callTool(harness.writeStdin, { session_id: 0, chars: 'PASS\n' }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(invalid.isError).toBe(true)
    expect(invalid.content[0]?.text).toContain('session_id must be a positive integer')
    expect(completed.value?.output).toContain('PASS stdin-validation')
    expect(completed.value?.exit_code).toBe(0)
  })

  it('keeps a session usable after an invalid output limit', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:limit-validation', yield_time_ms: 0 }, execution(agent))
    const invalid = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      max_output_tokens: 0,
    }, execution(agent))
    const stillLive = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(invalid.isError).toBe(true)
    expect(invalid.content[0]?.text).toContain('max_output_tokens must be a positive finite number')
    expect(stillLive.value?.session_id).toBe(started.value?.session_id)
    expect(completed.value?.exit_code).toBe(0)
  })

  it('rejects a completed session and then accepts a fresh session', async () => {
    const completedCommand = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent))
    const stalePoll = await callTool(harness.writeStdin, {
      session_id: 1,
      chars: '',
    }, execution(agent))
    const started = await callTool(harness.execCommand, { cmd: 'interactive:after-completed', yield_time_ms: 0 }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(completedCommand.value?.exit_code).toBe(0)
    expect(stalePoll.isError).toBe(true)
    expect(stalePoll.content[0]?.text).toContain('unknown or completed')
    expect(completed.value?.output).toContain('PASS after-completed')
    expect(completed.value?.exit_code).toBe(0)
  })

  it('cleans up an aborted start and recovers with the next command', async () => {
    const controller = new AbortController()
    controller.abort()
    const aborted = await callTool(harness.execCommand, { cmd: 'slow' }, { agent, signal: controller.signal })
    const recovered = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent))

    expect(aborted.isError).toBe(true)
    expect(harness.service.liveSessionCount).toBe(0)
    expect(recovered.value).toMatchObject({ output: expect.stringContaining('PASS foreground'), exit_code: 0 })
  })

  it('walks one session through poll, partial input, poll, and completion', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:sequential-lifecycle', yield_time_ms: 0 }, execution(agent))
    const ready = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 250,
    }, execution(agent))
    const partial = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PA',
      yield_time_ms: 0,
    }, execution(agent))
    const waiting = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))
    const completed = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'SS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(`${started.value?.output}${ready.value?.output}`).toContain('READY sequential-lifecycle')
    expect(partial.value?.session_id).toBe(started.value?.session_id)
    expect(waiting.value?.session_id).toBe(started.value?.session_id)
    expect(completed.value).toMatchObject({ output: expect.stringContaining('PASS sequential-lifecycle'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
