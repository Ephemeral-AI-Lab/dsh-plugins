import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionsService } from '../src/service.js'

function header(id: string, createdAt: number) {
  return { version: 0, id: SessionId(id), createdAt }
}

function makeService(options: {
  headers?: readonly ReturnType<typeof header>[]
  agents?: readonly unknown[]
  titles?: readonly unknown[]
  readEvents?: readonly unknown[]
} = {}) {
  const ctx = {
    sessionPersistence: {
      list: vi.fn(async () => [...options.headers ?? []]),
      inspect: vi.fn(async () => ({ meta: options.headers?.[0], events: [...options.readEvents ?? []] })),
    },
    agents: {
      list: vi.fn(() => [...options.agents ?? []]),
      get: vi.fn((id: string) => options.agents?.find(agent => String((agent as { id: string }).id) === String(id))),
    },
    sessionQuery: {
      readTitleSnapshots: vi.fn(async () => [...options.titles ?? []]),
    },
  }
  return { service: new SessionsService(ctx as never), ctx }
}

describe('SessionsService', () => {
  it('merges live and cold sessions, reads durable titles, and sorts newest first', async () => {
    const cold = header('cold', 1000)
    const live = header('live', 2000)
    const agent = {
      id: live.id,
      status: 'running',
      session: {
        id: live.id,
        header: live,
        events: [{ time: 4000 }],
      },
    }
    const { service, ctx } = makeService({
      headers: [cold, live],
      agents: [agent],
      titles: [
        { sessionId: cold.id, status: 'fulfilled', value: { session: cold, title: { title: 'Cold task' } } },
        { sessionId: live.id, status: 'fulfilled', value: { session: live, title: { title: 'Live task' } } },
      ],
    })

    await expect(service.listStatus()).resolves.toEqual({
      sessions: [
        { session_id: 'live', title: 'Live task', status: 'running', updated_at: new Date(4000).toISOString() },
        { session_id: 'cold', title: 'Cold task', status: 'cold', updated_at: new Date(1000).toISOString() },
      ],
    })
    expect(ctx.sessionPersistence.list).toHaveBeenCalledOnce()
    expect(ctx.sessionQuery.readTitleSnapshots).toHaveBeenCalledWith([cold.id, live.id], undefined)
  })

  it('keeps a session row when its title observation fails and falls back to its id', async () => {
    const missingTitle = header('missing-title', 1000)
    const { service } = makeService({
      headers: [missingTitle],
      titles: [{ sessionId: missingTitle.id, status: 'rejected', reason: new Error('title unavailable') }],
    })

    await expect(service.listStatus()).resolves.toEqual({
      sessions: [{ session_id: 'missing-title', status: 'cold', updated_at: new Date(1000).toISOString() }],
    })
  })

  it('applies limit after sorting', async () => {
    const first = header('first', 1000)
    const second = header('second', 2000)
    const { service } = makeService({ headers: [first, second] })

    await expect(service.listStatus({ recent_n: 1 })).resolves.toEqual({
      sessions: [{ session_id: 'second', status: 'cold', updated_at: new Date(2000).toISOString() }],
    })
  })

  it('defaults to the 50 most recent sessions', async () => {
    const headers = Array.from({ length: 51 }, (_, index) => header(`session-${index}`, index + 1))
    const { service } = makeService({ headers })

    const result = await service.listStatus()

    expect(result.sessions).toHaveLength(50)
    expect(result.sessions[0]?.session_id).toBe('session-50')
    expect(result.sessions.at(-1)?.session_id).toBe('session-1')
  })

  it('rejects invalid recent counts', async () => {
    const { service } = makeService()
    await expect(service.listStatus({ recent_n: 0 })).rejects.toThrow('recent_n must be a positive safe integer')
  })

  it('reads a live session using a 1-based offset and bounded limit', async () => {
    const live = header('live', 2000)
    const messages = [
      { id: 'message-1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
      { id: 'message-2', role: 'assistant', content: [{ type: 'text', text: 'world' }], source: { kind: 'model', provider: 'mock', model: 'mock' } },
    ]
    const agent = {
      id: live.id,
      session: { id: live.id, header: live, events: [], deriveMessages: vi.fn(() => messages) },
    }
    const { service, ctx } = makeService({ agents: [agent] })

    await expect(service.readSession({ session_id: 'live', offset: 2, limit: 1 })).resolves.toEqual({
      session_id: 'live',
      offset: 2,
      messages: [messages[1]],
      total_messages: 2,
    })
    expect(ctx.sessionPersistence.inspect).not.toHaveBeenCalled()
  })

  it('reads a cold session through persistence without resuming it', async () => {
    const cold = header('cold', 1000)
    const events = [
      { seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: {
        id: 'message-1',
        role: 'user',
        content: [{ type: 'text', text: 'cold prompt' }],
        source: { kind: 'user' },
      } },
    ]
    const { service, ctx } = makeService({ headers: [cold], readEvents: events })

    await expect(service.readSession({ session_id: 'cold' })).resolves.toEqual({
      session_id: 'cold',
      offset: 1,
      messages: [{
        id: 'message-1',
        role: 'user',
        content: [{ type: 'text', text: 'cold prompt' }],
        source: { kind: 'user' },
      }],
      total_messages: 1,
    })
    expect(ctx.sessionPersistence.inspect).toHaveBeenCalledWith(cold.id, undefined)
  })

  it('checks one live, cold, or missing session without resuming it', async () => {
    const cold = header('cold', 1000)
    const live = header('live', 2000)
    const agent = {
      id: live.id,
      status: 'idle',
      session: { id: live.id, header: live, events: [{ time: 3000 }] },
    }
    const { service, ctx } = makeService({
      headers: [cold],
      agents: [agent],
      titles: [{ sessionId: live.id, status: 'fulfilled', value: { session: live, title: { title: 'Live task' } } }],
    })

    await expect(service.listStatus({ session_id: 'live' })).resolves.toMatchObject({
      sessions: [{ session_id: 'live', title: 'Live task', status: 'idle', updated_at: new Date(3000).toISOString() }],
    })
    await expect(service.listStatus({ session_id: 'cold' })).resolves.toMatchObject({
      sessions: [{ session_id: 'cold', status: 'cold', updated_at: new Date(1000).toISOString() }],
    })
    await expect(service.listStatus({ session_id: 'missing' })).resolves.toEqual({
      sessions: [{ session_id: 'missing', status: 'missing' }],
    })
    expect(ctx.agents.get).toHaveBeenCalled()
  })
})
