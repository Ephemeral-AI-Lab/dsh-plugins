import { describe, expect, it, vi } from 'vitest'
import {
  LoopInputError,
  LoopLogError,
  LoopRuntime,
  chooseDelivery,
  createLoopRecord,
  foldLoopEvents,
  loopView,
  nextOccurrence,
  flushPersistence,
} from '../src/loop.js'
function event(data: unknown, seq = 0) {
  return { type: 'loop/change', seq, time: 0, data } as never
}

describe('claude-code-loop domain', () => {
  it('defaults allow_steer to true and uses seconds-only input', () => {
    const record = createLoopRecord('check status', 5, undefined, 1000, 'loop_1')
    expect(record).toEqual({
      id: 'loop_1',
      prompt: 'check status',
      time_in_seconds: 5,
      allow_steer: true,
      next_at: 6000,
    })
  })

  it('trims prompts, preserves explicit false, and generates a non-empty id', () => {
    const record = createLoopRecord('  check status  ', 5, false, 1000)

    expect(record.prompt).toBe('check status')
    expect(record.allow_steer).toBe(false)
    expect(record.id.startsWith('loop_')).toBe(true)
    expect(record.id.length).toBeGreaterThan(5)
  })

  it.each([
    ['empty prompt', ['', 5]],
    ['whitespace prompt', ['   ', 5]],
    ['zero seconds', ['check', 0]],
    ['negative seconds', ['check', -1]],
    ['fractional seconds', ['check', 1.5]],
    ['unsafe seconds', ['check', Number.MAX_SAFE_INTEGER + 1]],
    ['infinite seconds', ['check', Number.POSITIVE_INFINITY]],
  ])('rejects %s before creating a record', (_name, [prompt, seconds]) => {
    expect(() => createLoopRecord(prompt as string, seconds as number, true, 0, 'loop_1')).toThrow(LoopInputError)
  })

  it('rejects invalid booleans, clocks, and date overflow', () => {
    expect(() => createLoopRecord('check', 1, 'yes' as never, 0, 'loop_1')).toThrow('allow_steer')
    expect(() => createLoopRecord('check', 1, true, -1, 'loop_1')).toThrow('now')
    expect(() => createLoopRecord('check', 1, true, Number.MAX_SAFE_INTEGER + 1, 'loop_1')).toThrow('now')
    expect(() => createLoopRecord('check', 9_007_199_254_741, true, 0, 'loop_1')).toThrow('safe date range')
  })

  it('folds create, dispatch, and delete events', () => {
    const record = createLoopRecord('check', 5, true, 0, 'loop_1')
    const folded = foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'dispatch', id: 'loop_1', next_at: 10_000 }, 1),
    ])
    expect(folded.active[0]?.next_at).toBe(10_000)
    expect(foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'delete', id: 'loop_1' }, 1),
    ]).active).toEqual([])
  })

  it('ignores unrelated events and skips the configured seed prefix', () => {
    const record = createLoopRecord('check', 5, true, 0, 'loop_1')
    const folded = foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }, 0),
      { type: 'message', seq: 1, time: 0, data: {} } as never,
      event({ version: 1, operation: 'create', loop: createLoopRecord('later', 5, true, 0, 'loop_2') }, 2),
    ], 2)

    expect(folded.active.map(loop => loop.id)).toEqual(['loop_2'])
    expect(folded.seenIds).toEqual(['loop_2'])
  })

  it.each([
    ['unsupported version', { version: 2, operation: 'delete', id: 'loop_1' }],
    ['invalid record id', { version: 1, operation: 'create', loop: { id: ' ', prompt: 'check', time_in_seconds: 1, allow_steer: true, next_at: 1000 } }],
    ['invalid record prompt', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: ' ', time_in_seconds: 1, allow_steer: true, next_at: 1000 } }],
    ['invalid record interval', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 0, allow_steer: true, next_at: 1000 } }],
    ['invalid record boolean', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 1, allow_steer: 'yes', next_at: 1000 } }],
    ['invalid record next_at', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 1, allow_steer: true, next_at: -1 } }],
  ])('fails closed for %s persisted data', (_name, data) => {
    expect(() => foldLoopEvents([event(data)])).toThrow(LoopLogError)
  })

  it('rejects duplicate ids, inactive deletes, and inactive dispatches', () => {
    const record = createLoopRecord('check', 5, true, 0, 'loop_1')
    expect(() => foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'delete', id: 'loop_1' }, 1),
      event({ version: 1, operation: 'create', loop: record }, 2),
    ])).toThrow('duplicate loop id')

    expect(() => foldLoopEvents([event({ version: 1, operation: 'delete', id: 'missing' })])).toThrow('inactive')
    expect(() => foldLoopEvents([event({ version: 1, operation: 'dispatch', id: 'missing', next_at: 1 })])).toThrow('inactive')
    expect(() => foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'dispatch', id: 'loop_1', next_at: 1000 }, 1),
    ])).toThrow('invalid next_at')
  })

  it('skips missed intervals instead of replaying a burst', () => {
    const record = createLoopRecord('check', 5, true, 0, 'loop_1')
    expect(nextOccurrence(record, 16_000)).toBe(20_000)
    expect(loopView(record, 500).state).toBe('scheduled')
    expect(loopView(record, 5000).state).toBe('overdue')
    expect(nextOccurrence(record, 4999)).toBe(5000)
    expect(nextOccurrence(record, Number.NaN)).toBe(5000)
  })

  it('steers only a running agent when allowed', () => {
    expect(chooseDelivery({ status: 'running' }, true)).toBe('steer')
    expect(chooseDelivery({ status: 'idle' }, true)).toBe('followup')
    expect(chooseDelivery({ status: 'running' }, false)).toBe('followup')
    expect(chooseDelivery({ status: 'error' }, true)).toBe('followup')
    expect(chooseDelivery({ status: 'stopped' }, true)).toBe('followup')
  })

  it('supports large safe intervals and rejects arithmetic overflow', () => {
    const record = createLoopRecord('check', 9_000_000_000_000, true, 0, 'loop_1')
    expect(record.next_at).toBe(9_000_000_000_000_000)
    expect(() => nextOccurrence(record, Number.MAX_SAFE_INTEGER)).toThrow(LoopInputError)
  })

  it('fails when session persistence reports incomplete flush', async () => {
    const ctx = { sessions: { flush: vi.fn(async () => false) } } as never
    const agent = { session: {} } as never

    await expect(flushPersistence(ctx, agent)).rejects.toThrow('Loop persistence did not complete')
  })

  it('does not restart a disposed runtime', async () => {
    const agent = { id: 'runtime', session: { events: [], header: {} } } as never
    const flush = vi.fn(async () => true)
    const ctx = { agents: { get: vi.fn(() => agent) }, sessions: { flush } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    await runtime.dispose()
    runtime.requestDrive()

    expect(flush).not.toHaveBeenCalled()
  })

  it('stops before folding when the agent disappears during persistence', async () => {
    const agent = { id: 'runtime', session: { events: [], header: {} }, followup: vi.fn(), steer: vi.fn() } as never
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const flushStarted = new Promise<void>(resolve => { started = resolve })
    const flush = vi.fn(async () => {
      started()
      await gate
      return true
    })
    const getAgent = vi.fn(() => agent)
    const ctx = { agents: { get: getAgent }, sessions: { flush } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    runtime.requestDrive()
    await flushStarted
    getAgent.mockReturnValue(undefined)
    release()
    await runtime.transact(async () => undefined)

    expect(agent.followup).not.toHaveBeenCalled()
  })

  it('restarts after a drive failure when another drive was requested', async () => {
    const agent = { id: 'runtime', session: { events: [], header: {} } } as never
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const flushStarted = new Promise<void>(resolve => { started = resolve })
    const flush = vi.fn()
      .mockImplementationOnce(async () => {
        started()
        await gate
        throw new Error('transient')
      })
      .mockResolvedValue(true)
    const ctx = { agents: { get: vi.fn(() => agent) }, sessions: { flush } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    runtime.requestDrive()
    await flushStarted
    runtime.requestDrive()
    release()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(flush).toHaveBeenCalledTimes(2)
    await runtime.dispose()
  })
})
