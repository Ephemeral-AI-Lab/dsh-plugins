import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('session isolation and cleanup', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('owner-a')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('does not allow another agent to write to the session', async () => {
    const other = harness.agent('owner-b')
    const started = await callTool(harness.execCommand, { cmd: 'interactive:owned', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: 'PASS\n',
    }, execution(other))

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('belongs to a different agent owner')
    expect(harness.service.liveSessionCount).toBe(1)
  })

  it('cleans sessions when the owner scope is closed', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:cleanup', yield_time_ms: 0 }, execution(agent))
    expect(started.value?.session_id).toBeTypeOf('number')
    expect(harness.service.liveSessionCount).toBe(1)

    await agent.cleanup?.()

    expect(harness.service.liveSessionCount).toBe(0)
    const result = await callTool(harness.writeStdin, {
      session_id: started.value!.session_id,
      chars: '',
    }, execution(agent))
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unknown or completed')
  })

  it('keeps concurrent sessions independent', async () => {
    const other = harness.agent('owner-b')
    const [first, second] = await Promise.all([
      callTool(harness.execCommand, { cmd: 'interactive:first', yield_time_ms: 0 }, execution(agent)),
      callTool(harness.execCommand, { cmd: 'interactive:second', yield_time_ms: 0 }, execution(other)),
    ])

    expect(first.value?.session_id).not.toBe(second.value?.session_id)
    expect(harness.service.liveSessionCount).toBe(2)
  })
})
