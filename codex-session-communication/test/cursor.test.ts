import { afterEach, describe, expect, it } from 'vitest'
import { createPluginHarness, runTool, type TestEvent } from './support/plugin.js'

const sessionId = 'session-1'

function events(count: number): TestEvent[] {
  return Array.from({ length: count }, (_, seq) => ({ seq, type: `event-${seq}` }))
}

describe('read_session cursor semantics', () => {
  const harnesses: Array<ReturnType<typeof createPluginHarness>> = []

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.dispose()
  })

  it('returns next_seq 0 for an empty log', async () => {
    const harness = createPluginHarness()
    harnesses.push(harness)

    await expect(runTool(harness.tool('read_session'), {
      session_id: sessionId,
      after_seq: -1,
    })).resolves.toEqual({
      events: [],
      next_seq: 0,
      has_more: false,
    })
    expect(harness.persistence.readFrom).toHaveBeenCalledTimes(1)
    expect(harness.persistence.readFrom.mock.calls[0]?.slice(0, 2)).toEqual([sessionId, 0])
  })

  it('treats after_seq as exclusive', async () => {
    const harness = createPluginHarness(events(3))
    harnesses.push(harness)

    await expect(runTool(harness.tool('read_session'), {
      session_id: sessionId,
      after_seq: 1,
    })).resolves.toEqual({
      events: [{ seq: 2, type: 'event-2' }],
      next_seq: 3,
      has_more: false,
    })
    expect(harness.persistence.readFrom.mock.calls[0]?.slice(0, 2)).toEqual([sessionId, 2])
  })

  it('uses next_seq as the continuation cursor for limited reads', async () => {
    const harness = createPluginHarness(events(10))
    harnesses.push(harness)
    const tool = harness.tool('read_session')

    const first = await runTool(tool, {
      session_id: sessionId,
      after_seq: -1,
      limit: 3,
    }) as { events: TestEvent[]; next_seq: number; has_more: boolean }
    const second = await runTool(tool, {
      session_id: sessionId,
      after_seq: first.next_seq - 1,
      limit: 3,
    }) as { events: TestEvent[]; next_seq: number; has_more: boolean }

    expect(first).toEqual({
      events: events(3),
      next_seq: 3,
      has_more: true,
    })
    expect(second).toEqual({
      events: events(10).slice(3, 6),
      next_seq: 6,
      has_more: true,
    })
    expect(harness.persistence.readFrom.mock.calls.map(call => call.slice(0, 2))).toEqual([
      [sessionId, 0],
      [sessionId, 3],
    ])
  })

  it('reports has_more only when unread events remain', async () => {
    const harness = createPluginHarness(events(3))
    harnesses.push(harness)
    const tool = harness.tool('read_session')

    await expect(runTool(tool, {
      session_id: sessionId,
      after_seq: -1,
      limit: 3,
    })).resolves.toMatchObject({ next_seq: 3, has_more: false })

    await expect(runTool(tool, {
      session_id: sessionId,
      after_seq: 2,
      limit: 3,
    })).resolves.toEqual({
      events: [],
      next_seq: 3,
      has_more: false,
    })
  })
})
