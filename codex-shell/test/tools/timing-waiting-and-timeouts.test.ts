import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

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
    expect(result.value?.session_id).toBeTypeOf('number')
    expect(result.value?.exit_code).toBeUndefined()
  })

  it('returns delayed output after a subsequent poll', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
  })
})
