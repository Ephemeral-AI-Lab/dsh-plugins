import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'
import { delay } from '../../src/session/lifecycle.js'

describe('timing, waiting, and timeouts', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('timing-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('returns a live session instead of a fabricated exit code when waiting is zero', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value?.job_id).toBeTypeOf('string')
    expect(result.value?.exit_code).toBeUndefined()
  })

  it('returns delayed output after a subsequent poll', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: '',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
  })

  it('retains final output when a live session exits before polling starts', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const jobId = started.value?.job_id
    expect(jobId).toBeTypeOf('string')

    // The fixture exits naturally while no tool call is active.
    await delay(250)
    expect(harness.service.liveSessionCount).toBe(1)

    const result = await callTool(harness.writeStdin, {
      job_id: jobId,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
