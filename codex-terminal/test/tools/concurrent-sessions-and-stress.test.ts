import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('concurrent sessions and stress behavior', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('stress-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('keeps concurrent foreground results associated with their commands', async () => {
    const results = await Promise.all([
      callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent)),
      callTool(harness.execCommand, { cmd: 'fail', yield_time_ms: 1_000 }, execution(agent)),
      callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent)),
    ])

    expect(results.map(result => result.value?.exit_code)).toEqual([0, 1, 0])
    expect(results[0]?.value?.output).toContain('PASS foreground')
    expect(results[1]?.value?.output).toContain('FAIL simulated command')
    expect(results[2]?.value?.output).toContain('PASS foreground')
  })

  it('supports repeated interactive start/send/complete cycles', async () => {
    for (const label of ['one', 'two', 'three']) {
      const started = await callTool(harness.execCommand, { cmd: `interactive:${label}`, yield_time_ms: 0 }, execution(agent))
      const result = await callTool(harness.writeStdin, {
        job_id: started.value!.job_id,
        chars: 'PASS\n',
        yield_time_ms: 1_000,
      }, execution(agent))
      expect(result.value?.output).toContain(`PASS ${label}`)
      expect(result.value?.exit_code).toBe(0)
    }
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
