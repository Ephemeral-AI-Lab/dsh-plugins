import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('error handling and recovery', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('error-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('reports an unknown session as a tool error', async () => {
    const result = await callTool(harness.writeStdin, { job_id: 'codex-shell-999', chars: '' }, execution(agent))

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unknown or completed exec job codex-shell-999')
  })

  it('reports writes to a completed session as a tool error', async () => {
    const completed = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution(agent))
    const result = await callTool(harness.writeStdin, { job_id: 'codex-shell-1', chars: '' }, execution(agent))

    expect(completed.value?.exit_code).toBe(0)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unknown or completed')
  })

  it('does not leave a session after an aborted call', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await callTool(harness.execCommand, { cmd: 'slow' }, { agent, signal: controller.signal })

    expect(result.isError).toBe(true)
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
