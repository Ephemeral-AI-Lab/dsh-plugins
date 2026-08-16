import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('exec_command interactive sessions', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('interactive-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('returns a live session id when the command does not complete', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'interactive:poll', yield_time_ms: 1_000 }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value?.output).toContain('READY poll')
    expect(result.value?.session_id).toBeTypeOf('number')
    expect(result.value?.exit_code).toBeUndefined()
    expect(result.content[0]?.text).toContain('[session_id:')
  })

  it('returns a session immediately when the caller requests no waiting', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'interactive:no-wait', yield_time_ms: 0 }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value?.session_id).toBeTypeOf('number')
    expect(result.value?.exit_code).toBeUndefined()
  })
})
