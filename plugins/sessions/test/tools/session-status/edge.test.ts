import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionsService } from '../../../src/service.js'
import { registerSessionStatusTool } from '../../../src/tools/session-status.js'

type Header = ReturnType<typeof makeHeader>
type Tool = {
  name: string
  description: string
  parameters: any
  output: any
  execute(args: any, exec: { signal: AbortSignal }): Promise<any>
}

type FixtureOptions = {
  headers?: readonly Header[]
  agents?: readonly any[]
  titles?: readonly any[]
  list?: ReturnType<typeof vi.fn>
  locate?: ReturnType<typeof vi.fn>
  get?: ReturnType<typeof vi.fn>
  readTitles?: ReturnType<typeof vi.fn>
}

function makeHeader(id: string, createdAt: number) {
  return { version: 0, id: SessionId(id), createdAt }
}

function makeAgent(id: string, status: 'running' | 'idle', createdAt: number, events: readonly any[] = []) {
  const header = makeHeader(id, createdAt)
  return { id: SessionId(id), status, session: { id: SessionId(id), header, events } }
}

function fulfilledTitle(id: string, title: string) {
  return { sessionId: SessionId(id), status: 'fulfilled', value: { session: { id: SessionId(id) }, title: { title } } }
}

function rejectedTitle(id: string) {
  return { sessionId: SessionId(id), status: 'rejected', reason: new Error(`title unavailable: ${id}`) }
}

function makeFixture(options: FixtureOptions = {}) {
  const headers = options.headers ?? []
  const agents = options.agents ?? []
  const list = options.list ?? vi.fn(async () => [...headers])
  const locate = options.locate ?? vi.fn(() => undefined)
  const get = options.get ?? vi.fn((id: unknown) => agents.find(agent => String(agent.id) === String(id)))
  const readTitles = options.readTitles ?? vi.fn(async () => [...options.titles ?? []])
  const ctx = {
    sessionPersistence: { list, locate },
    agents: { list: vi.fn(() => [...agents]), get },
    sessionQuery: { readTitleSnapshots: readTitles },
    tools: {
      register(definition: Tool) {
        tool = definition
        return () => {}
      },
    },
  }
  const service = new SessionsService(ctx as never)
  let tool: Tool | undefined
  registerSessionStatusTool(ctx as never, service)
  if (tool === undefined) throw new Error('session_status was not registered')
  return { ctx, get, list, locate, readTitles, service, tool }
}

function invoke(tool: Tool, args: any = {}, signal = new AbortController().signal) {
  return tool.execute(args, { signal })
}

describe('session_status tool — EASY (30)', () => {
  it('[E01] registers the session_status name', () => {
    expect(makeFixture().tool.name).toBe('session_status')
  })

  it('[E02] describes both listing and exact lookup', () => {
    expect(makeFixture().tool.description).toContain('List recent sessions')
    expect(makeFixture().tool.description).toContain('one exact session')
  })

  it('[E03] makes session_id optional', () => {
    const parameters = makeFixture().tool.parameters
    expect(parameters.properties.session_id).toMatchObject({ type: 'string' })
    expect(parameters.required ?? []).not.toContain('session_id')
  })

  it('[E04] declares the default recent count', () => {
    expect(makeFixture().tool.parameters.properties.recent_n).toMatchObject({ type: 'number', default: 50 })
  })

  it('[E05] requires a sessions array in the output schema', () => {
    expect(makeFixture().tool.output.schema.properties.sessions).toMatchObject({ type: 'array' })
    expect(makeFixture().tool.output.schema.required).toContain('sessions')
  })

  it('[E06] advertises all current statuses', () => {
    expect(makeFixture().tool.output.schema.properties.sessions.items.properties.status.enum).toEqual([
      'running', 'idle', 'cold', 'missing',
    ])
  })

  it('[E07] lists sessions when called with no arguments', async () => {
    const { tool } = makeFixture({ headers: [makeHeader('one', 1)] })
    await expect(invoke(tool)).resolves.toMatchObject({ sessions: [{ session_id: 'one' }] })
  })

  it('[E08] accepts a recent_n argument through the tool', async () => {
    const { tool } = makeFixture({ headers: [makeHeader('one', 1), makeHeader('two', 2)] })
    await expect(invoke(tool, { recent_n: 1 })).resolves.toEqual({
      sessions: [{ session_id: 'two', status: 'cold', updated_at: new Date(2).toISOString() }],
    })
  })

  it('[E09] accepts an exact session_id through the tool', async () => {
    const { tool } = makeFixture({ headers: [makeHeader('one', 1), makeHeader('two', 2)] })
    await expect(invoke(tool, { session_id: 'one' })).resolves.toMatchObject({
      sessions: [{ session_id: 'one', status: 'cold' }],
    })
  })

  it('[E10] returns an empty list when there are no sessions', async () => {
    await expect(makeFixture().service.listStatus()).resolves.toEqual({ sessions: [] })
  })

  it('[E11] defaults to the 50 most recent sessions', async () => {
    const headers = Array.from({ length: 51 }, (_, index) => makeHeader(`s${index}`, index + 1))
    const result = await makeFixture({ headers }).service.listStatus()
    expect(result.sessions).toHaveLength(50)
    expect(result.sessions[0]?.session_id).toBe('s50')
  })

  it('[E12] applies an exact positive limit', async () => {
    const result = await makeFixture({
      headers: [makeHeader('one', 1), makeHeader('two', 2), makeHeader('three', 3)],
    }).service.listStatus({ recent_n: 2 })
    expect(result.sessions.map(session => session.session_id)).toEqual(['three', 'two'])
  })

  it('[E13] sorts newest sessions first', async () => {
    const result = await makeFixture({
      headers: [makeHeader('old', 1), makeHeader('new', 3), makeHeader('middle', 2)],
    }).service.listStatus()
    expect(result.sessions.map(session => session.session_id)).toEqual(['new', 'middle', 'old'])
  })

  it('[E14] uses session_id as a deterministic tie breaker', async () => {
    const result = await makeFixture({
      headers: [makeHeader('zeta', 1), makeHeader('alpha', 1)],
    }).service.listStatus()
    expect(result.sessions.map(session => session.session_id)).toEqual(['alpha', 'zeta'])
  })

  it('[E15] reports persisted-only sessions as cold', async () => {
    await expect(makeFixture({ headers: [makeHeader('cold', 1)] }).service.listStatus()).resolves.toMatchObject({
      sessions: [{ session_id: 'cold', status: 'cold' }],
    })
  })

  it('[E16] reports idle live sessions as idle', async () => {
    const agent = makeAgent('idle', 'idle', 1)
    await expect(makeFixture({ agents: [agent] }).service.listStatus()).resolves.toMatchObject({
      sessions: [{ session_id: 'idle', status: 'idle' }],
    })
  })

  it('[E17] reports running live sessions as running', async () => {
    const agent = makeAgent('running', 'running', 1)
    await expect(makeFixture({ agents: [agent] }).service.listStatus()).resolves.toMatchObject({
      sessions: [{ session_id: 'running', status: 'running' }],
    })
  })

  it('[E18] includes a fulfilled title', async () => {
    const result = await makeFixture({
      headers: [makeHeader('titled', 1)],
      titles: [fulfilledTitle('titled', 'A task')],
    }).service.listStatus()
    expect(result.sessions[0]).toMatchObject({ session_id: 'titled', title: 'A task' })
  })

  it('[E19] omits an unavailable title', async () => {
    const result = await makeFixture({
      headers: [makeHeader('untitled', 1)],
      titles: [rejectedTitle('untitled')],
    }).service.listStatus()
    expect(result.sessions[0]).not.toHaveProperty('title')
  })

  it('[E20] reports created_at when a session has no events', async () => {
    const result = await makeFixture({ headers: [makeHeader('created', 1234)] }).service.listStatus()
    expect(result.sessions[0]?.updated_at).toBe(new Date(1234).toISOString())
  })

  it('[E21] reports the latest live event time', async () => {
    const result = await makeFixture({
      agents: [makeAgent('live', 'idle', 1, [{ time: 2 }, { time: 99 }])],
    }).service.listStatus()
    expect(result.sessions[0]?.updated_at).toBe(new Date(99).toISOString())
  })

  it('[E22] reads durable headers for a list query', async () => {
    const { list } = makeFixture()
    await new SessionsService({
      sessionPersistence: { list },
      agents: { list: () => [], get: () => undefined },
      sessionQuery: { readTitleSnapshots: async () => [] },
    } as never).listStatus()
    expect(list).toHaveBeenCalledOnce()
  })

  it('[E23] includes live sessions even without durable headers', async () => {
    const result = await makeFixture({ agents: [makeAgent('live-only', 'idle', 4)] }).service.listStatus()
    expect(result.sessions.map(session => session.session_id)).toEqual(['live-only'])
  })

  it('[E24] lets live state override a duplicate persisted row', async () => {
    const result = await makeFixture({
      headers: [makeHeader('same', 1)],
      agents: [makeAgent('same', 'running', 2)],
    }).service.listStatus()
    expect(result.sessions).toEqual([{
      session_id: 'same', status: 'running', updated_at: new Date(2).toISOString(),
    }])
  })

  it('[E25] returns missing for an unknown exact session', async () => {
    await expect(makeFixture().service.listStatus({ session_id: 'unknown' })).resolves.toEqual({
      sessions: [{ session_id: 'unknown', status: 'missing' }],
    })
  })

  it('[E26] trims an exact session id before lookup', async () => {
    const { service, get } = makeFixture({ headers: [makeHeader('known', 1)] })
    await expect(service.listStatus({ session_id: '  known  ' })).resolves.toMatchObject({
      sessions: [{ session_id: 'known' }],
    })
    expect(get).toHaveBeenCalledWith(SessionId('known'))
  })

  it('[E27] returns one row for an exact query', async () => {
    const result = await makeFixture({ headers: [makeHeader('one', 1), makeHeader('two', 2)] })
      .service.listStatus({ session_id: 'one', recent_n: 1 })
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]?.session_id).toBe('one')
  })

  it('[E28] queries titles using all listed ids', async () => {
    const { service, readTitles } = makeFixture({ headers: [makeHeader('one', 1), makeHeader('two', 2)] })
    await service.listStatus()
    expect(readTitles).toHaveBeenCalledWith([SessionId('one'), SessionId('two')], undefined)
  })

  it('[E29] serializes a normal tool result as JSON text', async () => {
    const { tool } = makeFixture({ headers: [makeHeader('one', 1)] })
    const value = await invoke(tool)
    expect(tool.output.render({}, value)).toEqual([{ type: 'text', text: JSON.stringify(value) }])
  })

  it('[E30] preserves the status row shape for a normal session', async () => {
    const result = await makeFixture({ headers: [makeHeader('one', 1)] }).service.listStatus()
    expect(Object.keys(result.sessions[0] ?? {}).sort()).toEqual(['session_id', 'status', 'updated_at'])
  })

  it('[E31] includes the backend-owned session path', async () => {
    const path = '/sessions/project/session-one/session.jsonl'
    const result = await makeFixture({
      headers: [makeHeader('one', 1)],
      locate: vi.fn(() => ({ kind: 'jsonl', path })),
    }).service.listStatus()
    expect(result.sessions[0]).toMatchObject({ session_id: 'one', session_path: path })
  })
})

describe('session_status tool — MEDIUM (20)', () => {
  it('[M01] accepts a limit of one', async () => {
    await expect(makeFixture({ headers: [makeHeader('one', 1)] }).service.listStatus({ recent_n: 1 }))
      .resolves.toMatchObject({ sessions: [{ session_id: 'one' }] })
  })

  it('[M02] rejects a zero recent_n', async () => {
    await expect(makeFixture().service.listStatus({ recent_n: 0 })).rejects.toThrow('recent_n')
  })

  it('[M03] rejects a negative recent_n', async () => {
    await expect(makeFixture().service.listStatus({ recent_n: -1 })).rejects.toThrow('recent_n')
  })

  it('[M04] rejects a fractional recent_n', async () => {
    await expect(makeFixture().service.listStatus({ recent_n: 1.5 })).rejects.toThrow('recent_n')
  })

  it('[M05] rejects Infinity as recent_n', async () => {
    await expect(makeFixture().service.listStatus({ recent_n: Infinity })).rejects.toThrow('recent_n')
  })

  it('[M06] rejects NaN as recent_n', async () => {
    await expect(makeFixture().service.listStatus({ recent_n: NaN })).rejects.toThrow('recent_n')
  })

  it('[M07] rejects an unsafe recent_n', async () => {
    await expect(makeFixture().service.listStatus({ recent_n: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow('recent_n')
  })

  it('[M08] rejects an empty exact session id', async () => {
    await expect(makeFixture().service.listStatus({ session_id: '' })).rejects.toThrow('session_id')
  })

  it('[M09] rejects a whitespace-only exact session id', async () => {
    await expect(makeFixture().service.listStatus({ session_id: '   ' })).rejects.toThrow('session_id')
  })

  it('[M10] forwards the list abort signal to persistence', async () => {
    const signal = new AbortController().signal
    const list = vi.fn(async () => [])
    await makeFixture({ list }).service.listStatus({}, signal)
    expect(list).toHaveBeenCalledWith(signal)
  })

  it('[M11] forwards the exact-query abort signal to persistence', async () => {
    const signal = new AbortController().signal
    const list = vi.fn(async () => [])
    await makeFixture({ list }).service.listStatus({ session_id: 'missing' }, signal)
    expect(list).toHaveBeenCalledWith(signal)
  })

  it('[M12] forwards session ids to the title query', async () => {
    const { service, readTitles } = makeFixture({ headers: [makeHeader('one', 1)] })
    await service.listStatus()
    expect(readTitles.mock.calls[0]?.[0]).toEqual([SessionId('one')])
  })

  it('[M13] ignores a fulfilled title observation without a title', async () => {
    const result = await makeFixture({
      headers: [makeHeader('one', 1)],
      titles: [{ sessionId: SessionId('one'), status: 'fulfilled', value: { session: { id: SessionId('one') } } }],
    }).service.listStatus()
    expect(result.sessions[0]).not.toHaveProperty('title')
  })

  it('[M14] ignores rejected title observations', async () => {
    const result = await makeFixture({ headers: [makeHeader('one', 1)], titles: [rejectedTitle('one')] })
      .service.listStatus()
    expect(result.sessions[0]).toMatchObject({ session_id: 'one', status: 'cold' })
  })

  it('[M15] ignores title observations for another session', async () => {
    const result = await makeFixture({
      headers: [makeHeader('one', 1)],
      titles: [fulfilledTitle('other', 'Wrong task')],
    }).service.listStatus()
    expect(result.sessions[0]).not.toHaveProperty('title')
  })

  it('[M16] preserves live event ordering over header ordering', async () => {
    const result = await makeFixture({
      headers: [makeHeader('new-header', 100)],
      agents: [makeAgent('old-header-live', 'idle', 1, [{ time: 200 }])],
    }).service.listStatus()
    expect(result.sessions.map(session => session.session_id)).toEqual(['old-header-live', 'new-header'])
  })

  it('[M17] uses the live header when it replaces a duplicate', async () => {
    const result = await makeFixture({
      headers: [makeHeader('same', 10)],
      agents: [makeAgent('same', 'idle', 20)],
    }).service.listStatus()
    expect(result.sessions[0]?.updated_at).toBe(new Date(20).toISOString())
  })

  it('[M18] uses a live header when there are no live events', async () => {
    const result = await makeFixture({ agents: [makeAgent('live', 'idle', 42)] }).service.listStatus()
    expect(result.sessions[0]?.updated_at).toBe(new Date(42).toISOString())
  })

  it('[M19] applies recent_n after sorting', async () => {
    const result = await makeFixture({
      headers: [makeHeader('old', 1), makeHeader('new', 3), makeHeader('middle', 2)],
    }).service.listStatus({ recent_n: 2 })
    expect(result.sessions.map(session => session.session_id)).toEqual(['new', 'middle'])
  })

  it('[M20] accepts the largest safe recent_n', async () => {
    await expect(makeFixture({ headers: [makeHeader('one', 1)] }).service.listStatus({ recent_n: Number.MAX_SAFE_INTEGER }))
      .resolves.toMatchObject({ sessions: [{ session_id: 'one' }] })
  })
})

describe('session_status tool — HARD (10)', () => {
  it('[H01] propagates persistence list failures', async () => {
    const error = new Error('persistence down')
    const list = vi.fn(async () => { throw error })
    await expect(makeFixture({ list }).service.listStatus()).rejects.toBe(error)
  })

  it('[H02] propagates title query failures', async () => {
    const error = new Error('title query down')
    const readTitles = vi.fn(async () => { throw error })
    await expect(makeFixture({ headers: [makeHeader('one', 1)], readTitles }).service.listStatus()).rejects.toBe(error)
  })

  it('[H03] propagates agent lookup failures', async () => {
    const error = new Error('agent lookup down')
    const get = vi.fn(() => { throw error })
    await expect(makeFixture({ get }).service.listStatus({ session_id: 'one' })).rejects.toBe(error)
  })

  it('[H04] forwards an already-aborted signal without replacing it', async () => {
    const controller = new AbortController()
    controller.abort()
    const list = vi.fn(async () => [])
    await makeFixture({ list }).service.listStatus({ session_id: 'missing' }, controller.signal)
    expect(list.mock.calls[0]?.[0]).toBe(controller.signal)
    expect(controller.signal.aborted).toBe(true)
  })

  it('[H05] merges duplicate live and persisted records into one row', async () => {
    const result = await makeFixture({
      headers: [makeHeader('same', 1)],
      agents: [makeAgent('same', 'running', 2, [{ time: 3 }])],
    }).service.listStatus()
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({ session_id: 'same', status: 'running', updated_at: new Date(3).toISOString() })
  })

  it('[H06] uses live status for an exact duplicate lookup', async () => {
    const result = await makeFixture({
      headers: [makeHeader('same', 1)],
      agents: [makeAgent('same', 'idle', 2)],
    }).service.listStatus({ session_id: 'same' })
    expect(result.sessions[0]).toMatchObject({ session_id: 'same', status: 'idle', updated_at: new Date(2).toISOString() })
  })

  it('[H07] keeps tied timestamps deterministic across input order', async () => {
    const result = await makeFixture({
      headers: [makeHeader('z', 5), makeHeader('a', 5), makeHeader('m', 5)],
    }).service.listStatus()
    expect(result.sessions.map(session => session.session_id)).toEqual(['a', 'm', 'z'])
  })

  it('[H08] does not call title lookup for an empty listing', async () => {
    const { service, readTitles } = makeFixture()
    await service.listStatus()
    expect(readTitles).not.toHaveBeenCalled()
  })

  it('[H09] keeps a missing exact query to one row even with a large limit', async () => {
    const result = await makeFixture().service.listStatus({ session_id: 'missing', recent_n: Number.MAX_SAFE_INTEGER })
    expect(result).toEqual({ sessions: [{ session_id: 'missing', status: 'missing' }] })
  })

  it('[H10] preserves a rejected title result while retaining the session row', async () => {
    const result = await makeFixture({
      headers: [makeHeader('one', 1)],
      titles: [rejectedTitle('one')],
    }).service.listStatus({ session_id: 'one' })
    expect(result).toEqual({
      sessions: [{ session_id: 'one', status: 'cold', updated_at: new Date(1).toISOString() }],
    })
  })
})
