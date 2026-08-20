import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('tool registration and validation', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('validation-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('registers exec_command and write_stdin with the expected names', () => {
    expect(harness.execCommand.name).toBe('exec_command')
    expect(harness.writeStdin.name).toBe('write_stdin')
  })

  it('rejects invalid command and write arguments before starting a process', async () => {
    const blank = await callTool(harness.execCommand, { cmd: '   ' }, execution(agent))
    const negativeWait = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: -1 }, execution(agent))
    const invalidSession = await callTool(harness.writeStdin, { job_id: 'invalid' }, execution(agent))
    const invalidLimit = await callTool(harness.writeStdin, { job_id: 'codex-terminal-1', max_output_tokens: 0 }, execution(agent))

    expect(blank.isError).toBe(true)
    expect(blank.content[0]?.text).toContain('cmd must be a non-empty string')
    expect(negativeWait.content[0]?.text).toContain('yield_time_ms must be a non-negative finite number')
    expect(invalidSession.content[0]?.text).toContain('job_id must be a codex-terminal job id')
    expect(invalidLimit.content[0]?.text).toContain('max_output_tokens must be a positive finite number')
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
