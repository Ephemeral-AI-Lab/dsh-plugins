import { describe, expect, it, vi } from 'vitest'
import {
  LoopInputError,
  LoopLogError,
  LoopRuntime,
  LoopRuntimeError,
  createLoopRecord,
  foldLoopEvents,
  loopView,
  nextOccurrence,
  renderLoopMessage,
  flushPersistence,
} from '../src/loop.js'
function event(data: unknown, seq = 0) {
  return { type: 'loop/change', seq, time: 0, data } as never
}

describe('loop domain', () => {
  it('uses prompt and seconds-only input', () => {
    const record = createLoopRecord('check status', 5, 1000, 'loop_1')
    expect(record).toEqual({
      id: 'loop_1',
      prompt: 'check status',
      time_in_seconds: 5,
      next_at: 6000,
    })
  })

  it('trims prompts and generates a non-empty id', () => {
    const record = createLoopRecord('  check status  ', 5, 1000)

    expect(record.prompt).toBe('check status')
    expect(record.id.startsWith('loop_')).toBe(true)
    expect(record.id.length).toBeGreaterThan(5)
  })

  it('renders an escaped heartbeat message', () => {
    expect(renderLoopMessage('loop_1', 'check <build> & deploy')).toBe([
      '<heartbeat>',
      '  <loop_id>loop_1</loop_id>',
      '  <prompt>check &lt;build&gt; &amp; deploy</prompt>',
      '</heartbeat>',
    ].join('\n'))
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
    expect(() => createLoopRecord(prompt as string, seconds as number, 0, 'loop_1')).toThrow(LoopInputError)
  })

  it('rejects invalid clocks and date overflow', () => {
    expect(() => createLoopRecord('check', 1, -1, 'loop_1')).toThrow('now')
    expect(() => createLoopRecord('check', 1, Number.MAX_SAFE_INTEGER + 1, 'loop_1')).toThrow('now')
    expect(() => createLoopRecord('check', 9_007_199_254_741, 0, 'loop_1')).toThrow('safe date range')
  })

  it('folds create, dispatch, and delete events', () => {
    const record = createLoopRecord('check', 5, 0, 'loop_1')
    const folded = foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'dispatch', id: 'loop_1', next_at: 10_000 }, 1),
    ])
    expect(folded.active[0]?.next_at).toBe(10_000)
    expect(foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'delete', id: 'loop_1' }, 1),
    ]).active).toEqual([])

    const updated = { ...record, next_at: 8_000 }
    expect(foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'update', loop: updated }, 1),
    ]).active).toEqual([updated])
  })

  it('ignores unrelated events and skips the configured seed prefix', () => {
    const record = createLoopRecord('check', 5, 0, 'loop_1')
    const folded = foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }, 0),
      { type: 'message', seq: 1, time: 0, data: {} } as never,
      event({ version: 1, operation: 'create', loop: createLoopRecord('later', 5, 0, 'loop_2') }, 2),
    ], 2)

    expect(folded.active.map(loop => loop.id)).toEqual(['loop_2'])
    expect(folded.seenIds).toEqual(['loop_2'])
  })

  it.each([
    ['unsupported version', { version: 2, operation: 'delete', id: 'loop_1' }],
    ['unknown operation', { version: 1, operation: 'rename', id: 'loop_1' }],
    ['missing create record', { version: 1, operation: 'create' }],
    ['missing delete id', { version: 1, operation: 'delete' }],
    ['missing dispatch fields', { version: 1, operation: 'dispatch' }],
    ['null record', { version: 1, operation: 'create', loop: null }],
    ['unknown record field', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 1, next_at: 1000, extra: true } }],
    ['invalid legacy title', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 1, next_at: 1000, title: 1 } }],
    ['invalid legacy steer flag', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 1, next_at: 1000, allow_steer: 'no' } }],
    ['invalid record id', { version: 1, operation: 'create', loop: { id: ' ', prompt: 'check', time_in_seconds: 1, next_at: 1000 } }],
    ['invalid record prompt', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: ' ', time_in_seconds: 1, next_at: 1000 } }],
    ['invalid record interval', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 0, next_at: 1000 } }],
    ['non-numeric record interval', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: '1', next_at: 1000 } }],
    ['invalid record next_at', { version: 1, operation: 'create', loop: { id: 'loop_1', prompt: 'check', time_in_seconds: 1, next_at: -1 } }],
  ])('fails closed for %s persisted data', (_name, data) => {
    expect(() => foldLoopEvents([event(data)])).toThrow(LoopLogError)
  })

  it('rejects duplicate ids, inactive deletes, and inactive dispatches', () => {
    const record = createLoopRecord('check', 5, 0, 'loop_1')
    expect(() => foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'delete', id: 'loop_1' }, 1),
      event({ version: 1, operation: 'create', loop: record }, 2),
    ])).toThrow('duplicate loop id')

    expect(() => foldLoopEvents([event({ version: 1, operation: 'delete', id: 'missing' })])).toThrow('inactive')
    expect(() => foldLoopEvents([event({ version: 1, operation: 'dispatch', id: 'missing', next_at: 1 })])).toThrow('inactive')
    expect(() => foldLoopEvents([event({ version: 1, operation: 'update', loop: record })])).toThrow('inactive')
    expect(() => foldLoopEvents([
      event({ version: 1, operation: 'create', loop: record }),
      event({ version: 1, operation: 'dispatch', id: 'loop_1', next_at: 1000 }, 1),
    ])).toThrow('invalid next_at')
  })

  it('skips missed intervals instead of replaying a burst', () => {
    const record = createLoopRecord('check', 5, 0, 'loop_1')
    expect(nextOccurrence(record, 16_000)).toBe(20_000)
    expect(loopView(record, 500).state).toBe('scheduled')
    expect(loopView(record, 5000).state).toBe('overdue')
    expect(nextOccurrence(record, 4999)).toBe(5000)
    expect(nextOccurrence(record, Number.NaN)).toBe(5000)
  })

  it('supports large safe intervals and rejects arithmetic overflow', () => {
    const record = createLoopRecord('check', 9_000_000_000_000, 0, 'loop_1')
    expect(record.next_at).toBe(9_000_000_000_000_000)
    expect(() => nextOccurrence(record, Number.MAX_SAFE_INTEGER)).toThrow(LoopInputError)
  })

  it('fails when session persistence reports incomplete flush', async () => {
    const ctx = { sessions: { flush: vi.fn(async () => false) } } as never
    const agent = { session: {} } as never

    await expect(flushPersistence(ctx, agent)).rejects.toThrow('Loop persistence did not complete')
  })

  it('rejects an invalid seed boundary', () => {
    expect(() => foldLoopEvents([], 1)).toThrow(LoopLogError)
    expect(new LoopRuntimeError('runtime', 'text').message).toBe('text')
  })

  it('does not restart a disposed runtime', async () => {
    const agent = { id: 'runtime', session: { events: [], header: {} } } as never
    const flush = vi.fn(async () => true)
    const ctx = { agents: { get: vi.fn(() => agent) }, sessions: { flush } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    await runtime.dispose()
    runtime.requestDrive()

    expect(flush).not.toHaveBeenCalled()
    await expect(runtime.transact(async () => undefined)).rejects.toThrow('disposed')
  })

  it.each([
    ['initial-flush', async () => false, () => undefined],
    ['send', async () => true, () => { throw new Error('send failed') }],
    ['dispatch-append', async () => true, () => undefined],
    ['post-dispatch-flush', async () => true, () => undefined],
  ] as const)('reports the %s drive failure phase', async (phase, flushResult, sendResult) => {
    const record = createLoopRecord('check', 1, 0, 'loop_1')
    const session = {
      events: [event({ version: 1, operation: 'create', loop: record })],
      header: {},
      append: vi.fn(sendResult === undefined ? () => undefined : () => undefined),
    }
    const send = vi.fn(sendResult)
    const flush = vi.fn(flushResult)
    if (phase === 'dispatch-append') session.append.mockImplementation(() => { throw new Error('append failed') })
    if (phase === 'post-dispatch-flush') flush.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('flush failed'))
    const agent = { id: 'runtime', session, status: 'idle', send } as never
    const ctx = { agents: { get: vi.fn(() => agent) }, sessions: { flush } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    runtime.requestDrive()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(runtime.lastError?.phase).toBe(phase)
    await runtime.dispose()
  })

  it('wraps malformed runtime failures and tolerates reporting failures', async () => {
    const agent = {
      id: 'runtime',
      session: { events: [event({ version: 1, operation: 'rename', id: 'loop_1' })], header: {} },
    } as never
    const report = vi.fn(() => { throw new Error('reporting failed') })
    const ctx = { agents: { get: vi.fn(() => agent) }, sessions: { flush: vi.fn(async () => true) } } as never
    const runtime = new LoopRuntime({ ctx, agent, onError: report })

    runtime.requestDrive()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(runtime.lastError).toBeInstanceOf(LoopRuntimeError)
    expect(runtime.lastError?.phase).toBe('runtime')
    expect(report).toHaveBeenCalledOnce()
    await runtime.dispose()
  })

  it('stops after the agent disappears before send', async () => {
    const record = createLoopRecord('check', 1, 0, 'loop_1')
    const agent = {
      id: 'runtime',
      session: { events: [event({ version: 1, operation: 'create', loop: record })], header: {} },
      send: vi.fn(),
    } as never
    const getAgent = vi.fn()
      .mockReturnValueOnce(agent)
      .mockReturnValueOnce(agent)
      .mockReturnValue(undefined)
    const ctx = { agents: { get: getAgent }, sessions: { flush: vi.fn(async () => true) } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    runtime.requestDrive()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(agent.send).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('lets a queued delete commit before a blocked drive sends', async () => {
    const record = createLoopRecord('check', 1, 0, 'loop_1')
    const session = {
      events: [event({ version: 1, operation: 'create', loop: record })],
      header: {},
      append: vi.fn(),
    }
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const flushStarted = new Promise<void>(resolve => { started = resolve })
    const flush = vi.fn(async () => {
      started()
      await gate
      return true
    })
    const agent = { id: 'runtime', session, status: 'idle', send: vi.fn() } as never
    const ctx = { agents: { get: vi.fn(() => agent) }, sessions: { flush } } as never
    const runtime = new LoopRuntime({ ctx, agent })

    runtime.requestDrive()
    await flushStarted
    const deleted = runtime.transact(async () => {
      session.events.push(event({ version: 1, operation: 'delete', id: record.id }, 1))
    })
    release()
    await deleted
    await runtime.transact(async () => undefined)

    expect(agent.send).not.toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(2)
    expect(foldLoopEvents(session.events).active).toEqual([])
    await runtime.dispose()
  })

  it('stops before folding when the agent disappears during persistence', async () => {
    const agent = { id: 'runtime', session: { events: [], header: {} }, send: vi.fn() } as never
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

    expect(agent.send).not.toHaveBeenCalled()
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
