import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('write_stdin result contract', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('contract-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('exposes failed command output and exit status through the simulated tool result', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:contract', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'FAIL\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value?.output).toContain('FAIL contract')
    expect(result.value?.exit_code).toBe(1)
    expect(result.content[0]?.text).toContain('FAIL contract')
    expect(result.content[0]?.text).toContain('[exit code: 1]')
    expect(result.content[0]?.text).not.toContain('Error: null')
  })

  it('never turns a successful stdin send into an Error:null result', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:no-null', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Error: null')
  })
})
