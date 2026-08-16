import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('exec_command foreground execution', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('foreground-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('returns stdout and exit code zero', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS foreground'), exit_code: 0 })
    expect(result.value?.session_id).toBeUndefined()
  })

  it('preserves stderr and a nonzero exit code as a command result', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'fail', yield_time_ms: 1_000 }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('FAIL simulated command'), exit_code: 1 })
    expect(result.value?.session_id).toBeUndefined()
  })

  it('returns a stable result shape and operation timing', async () => {
    const started = performance.now()
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent))
    const elapsed = performance.now() - started

    expect(result.value).toMatchObject({ output: expect.any(String), wall_time_seconds: expect.any(Number) })
    expect(result.value?.wall_time_seconds).toBeGreaterThanOrEqual(0)
    expect(result.value?.wall_time_seconds).toBeLessThan(5)
    expect(elapsed).toBeGreaterThanOrEqual(result.value!.wall_time_seconds * 1_000 - 50)
  })
})
