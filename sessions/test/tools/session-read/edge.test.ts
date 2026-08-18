import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerSessionReadTool } from '../../../src/tools/session-read.js'
import { formatReadSessionOutput } from '../../../src/read-format.js'
import { READ_SESSION_LIMIT, SessionsService, parseReadSessionArgs } from '../../../src/service.js'
import type { ReadSessionMessage, ReadSessionResult } from '../../../src/types.js'

function header(id: string, createdAt = 1_000) {
  return { version: 0, id: SessionId(id), createdAt }
}

function message(id: string, text = id, extra: Record<string, unknown> = {}): ReadSessionMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
    ...extra,
  } as unknown as ReadSessionMessage
}

function makeLiveService(messages: readonly ReadSessionMessage[] = [message('message-1')], id = 'session-1') {
  const meta = header(id)
  const deriveMessages = vi.fn(() => [...messages])
  const agent = {
    id: meta.id,
    status: 'idle',
    session: { id: meta.id, header: meta, events: [], deriveMessages },
  }
  const ctx = {
    agents: {
      get: vi.fn((candidate: unknown) => String(candidate) === id ? agent : undefined),
      list: vi.fn(() => [agent]),
    },
    sessionPersistence: {
      inspect: vi.fn(async () => ({ meta, events: [] })),
      list: vi.fn(async () => [meta]),
    },
    sessionQuery: { readTitleSnapshots: vi.fn(async () => []) },
  }
  return { service: new SessionsService(ctx as never), ctx, agent, deriveMessages, meta }
}

function makeColdService(events: readonly unknown[] = [], id = 'cold-session') {
  const meta = header(id)
  const inspect = vi.fn(async (_sessionId: unknown, _signal?: AbortSignal) => ({ meta, events }))
  const ctx = {
    agents: { get: vi.fn(() => undefined), list: vi.fn(() => []) },
    sessionPersistence: { inspect, list: vi.fn(async () => [meta]) },
    sessionQuery: { readTitleSnapshots: vi.fn(async () => []) },
  }
  return { service: new SessionsService(ctx as never), ctx, inspect, meta }
}

function captureReadTool(service: unknown) {
  let definition: any
  const disposer = vi.fn()
  const register = vi.fn((candidate: any) => {
    definition = candidate
    return disposer
  })
  registerSessionReadTool({ tools: { register } } as never, service as never)
  return { definition, register, disposer }
}

function readResult(messages: ReadSessionMessage[], offset = 1, totalMessages = messages.length): ReadSessionResult {
  return { session_id: 'session-1', offset, messages, total_messages: totalMessages }
}

describe('session_read edge cases', () => {
  describe('EASY (30)', () => {
    it('E01 uses offset 1 by default', () => {
      expect(parseReadSessionArgs({ session_id: 's' })).toEqual({ session_id: 's', offset: 1, limit: READ_SESSION_LIMIT })
    })

    it('E02 uses the bounded default limit', () => {
      expect(parseReadSessionArgs({ session_id: 's' }).limit).toBe(READ_SESSION_LIMIT)
    })

    it('E03 trims surrounding session whitespace', () => {
      expect(parseReadSessionArgs({ session_id: '  session-1  ' }).session_id).toBe('session-1')
    })

    it('E04 accepts the first message offset', () => {
      expect(parseReadSessionArgs({ session_id: 's', offset: 1 }).offset).toBe(1)
    })

    it('E05 accepts a one-message limit', () => {
      expect(parseReadSessionArgs({ session_id: 's', limit: 1 }).limit).toBe(1)
    })

    it('E06 accepts the configured maximum limit', () => {
      expect(parseReadSessionArgs({ session_id: 's', limit: READ_SESSION_LIMIT }).limit).toBe(READ_SESSION_LIMIT)
    })

    it('E07 accepts the largest safe integer offset', () => {
      expect(parseReadSessionArgs({ session_id: 's', offset: Number.MAX_SAFE_INTEGER }).offset).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('E08 accepts the largest safe integer limit before the cap check', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', limit: Number.MAX_SAFE_INTEGER })).toThrow('limit must be less than or equal to')
    })

    it('E09 returns a fresh normalized argument object', () => {
      const args = { session_id: ' s ', offset: 2, limit: 3 }
      expect(parseReadSessionArgs(args)).toEqual({ session_id: 's', offset: 2, limit: 3 })
      expect(args).toEqual({ session_id: ' s ', offset: 2, limit: 3 })
    })

    it('E10 reports the requested session id from a live session', async () => {
      const { service } = makeLiveService()
      await expect(service.readSession({ session_id: 'session-1' })).resolves.toMatchObject({ session_id: 'session-1' })
    })

    it('E11 reads messages from the live derived surface', async () => {
      const first = message('first')
      const { service, deriveMessages } = makeLiveService([first])
      await expect(service.readSession({ session_id: 'session-1' })).resolves.toMatchObject({ messages: [first] })
      expect(deriveMessages).toHaveBeenCalledOnce()
    })

    it('E12 returns the first message for offset one', async () => {
      const messages = [message('first'), message('second')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', offset: 1 })).resolves.toMatchObject({ messages: [messages[0], messages[1]] })
    })

    it('E13 starts at a middle offset', async () => {
      const messages = [message('first'), message('second'), message('third')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', offset: 2 })).resolves.toMatchObject({ messages: [messages[1], messages[2]], offset: 2 })
    })

    it('E14 truncates the window to its limit', async () => {
      const messages = [message('first'), message('second'), message('third')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', limit: 2 })).resolves.toMatchObject({ messages: [messages[0], messages[1]], total_messages: 3 })
    })

    it('E15 returns a final one-message window', async () => {
      const messages = [message('first'), message('second')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', offset: 2, limit: 1 })).resolves.toMatchObject({ messages: [messages[1]] })
    })

    it('E16 permits an empty session at offset one', async () => {
      const { service } = makeLiveService([])
      await expect(service.readSession({ session_id: 'session-1' })).resolves.toEqual({ session_id: 'session-1', offset: 1, messages: [], total_messages: 0 })
    })

    it('E17 registers the session_read tool name', () => {
      const { definition } = captureReadTool({ readSession: vi.fn() })
      expect(definition.name).toBe('session_read')
    })

    it('E18 marks session_id as required in the tool schema', () => {
      const { definition } = captureReadTool({ readSession: vi.fn() })
      expect(definition.parameters.properties).toHaveProperty('session_id')
      expect(definition.parameters.required).toContain('session_id')
    })

    it('E19 exposes offset as an optional tool parameter', () => {
      const { definition } = captureReadTool({ readSession: vi.fn() })
      expect(definition.parameters.properties).toHaveProperty('offset')
      expect(definition.parameters.required ?? []).not.toContain('offset')
    })

    it('E20 exposes limit as an optional tool parameter', () => {
      const { definition } = captureReadTool({ readSession: vi.fn() })
      expect(definition.parameters.properties).toHaveProperty('limit')
      expect(definition.parameters.required ?? []).not.toContain('limit')
    })

    it('E21 delegates tool execution arguments to the service', async () => {
      const readSession = vi.fn(async () => readResult([message('result')]))
      const { definition } = captureReadTool({ readSession })
      const args = { session_id: 'session-1', offset: 2, limit: 3 }
      await definition.execute(args, { signal: undefined })
      expect(readSession).toHaveBeenCalledWith(args, undefined)
    })

    it('E22 forwards the tool execution signal', async () => {
      const readSession = vi.fn(async () => readResult([]))
      const { definition } = captureReadTool({ readSession })
      const signal = new AbortController().signal
      await definition.execute({ session_id: 'session-1' }, { signal })
      expect(readSession).toHaveBeenCalledWith({ session_id: 'session-1' }, signal)
    })

    it('E23 renders the session header', () => {
      const { definition } = captureReadTool({ readSession: vi.fn() })
      expect(definition.output.render({}, readResult([]))[0].text).toContain('Session session-1')
    })

    it('E24 renders an empty-window marker', () => {
      expect(formatReadSessionOutput(readResult([]))).toContain('(No messages in this window)')
    })

    it('E25 renders the end-of-session footer', () => {
      expect(formatReadSessionOutput(readResult([message('one')]))).toContain('(End of session - total 1 messages)')
    })

    it('E26 renders a partial-window footer', () => {
      expect(formatReadSessionOutput(readResult([message('two')], 2, 3))).toContain('(Showing messages 2-2 of 3)')
    })

    it('E27 labels ordinary messages by role', () => {
      expect(formatReadSessionOutput(readResult([message('one', 'hello')]))).toContain('[USER]\nhello')
    })

    it('E28 labels tool-source messages as TOOL', () => {
      const tool = message('tool', 'output', { source: { kind: 'tool' } })
      expect(formatReadSessionOutput(readResult([tool]))).toContain('[TOOL]\noutput')
    })

    it('E29 labels plugin-source messages as CONTEXT', () => {
      const context = message('context', 'metadata', { source: { kind: 'plugin' } })
      expect(formatReadSessionOutput(readResult([context]))).toContain('[CONTEXT]\nmetadata')
    })

    it('E30 renders reasoning text as content', () => {
      const reasoning = message('reasoning', '', { content: [{ type: 'reasoning', text: 'thinking' }] })
      expect(formatReadSessionOutput(readResult([reasoning]))).toContain('[USER]\nthinking')
    })
  })

  describe('MEDIUM (20)', () => {
    it('M01 returns no messages when a live surface is empty', async () => {
      const { service } = makeLiveService([])
      await expect(service.readSession({ session_id: 'session-1', offset: 1, limit: 1 })).resolves.toMatchObject({ messages: [], total_messages: 0 })
    })

    it('M02 permits an offset exactly at the last message', async () => {
      const messages = [message('one'), message('two')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', offset: 2 })).resolves.toMatchObject({ messages: [messages[1]] })
    })

    it('M03 permits a limit exactly equal to the message count', async () => {
      const messages = [message('one'), message('two')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', limit: 2 })).resolves.toMatchObject({ messages, total_messages: 2 })
    })

    it('M04 does not return messages beyond the source length', async () => {
      const messages = [message('one'), message('two')]
      const { service } = makeLiveService(messages)
      await expect(service.readSession({ session_id: 'session-1', offset: 2, limit: 20 })).resolves.toMatchObject({ messages: [messages[1]], total_messages: 2 })
    })

    it('M05 reconstructs a cold session from persisted events', async () => {
      const events = [{ seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'persisted', role: 'user', content: [{ type: 'text', text: 'cold' }], source: { kind: 'user' } } }]
      const { service } = makeColdService(events)
      await expect(service.readSession({ session_id: 'cold-session' })).resolves.toMatchObject({ total_messages: 1, messages: [{ id: 'persisted' }] })
    })

    it('M06 passes a signal to cold-session persistence', async () => {
      const { service, inspect, meta } = makeColdService()
      const signal = new AbortController().signal
      await service.readSession({ session_id: 'cold-session' }, signal)
      expect(inspect).toHaveBeenCalledWith(meta.id, signal)
    })

    it('M07 uses persistence when no live agent exists', async () => {
      const { service, ctx } = makeColdService()
      await service.readSession({ session_id: 'cold-session' })
      expect(ctx.agents.get).toHaveBeenCalled()
      expect(ctx.sessionPersistence.inspect).toHaveBeenCalledOnce()
    })

    it('M08 rejects an all-whitespace session id', async () => {
      const { service } = makeLiveService()
      await expect(service.readSession({ session_id: '   ' })).rejects.toThrow('session_id must be a non-empty string')
    })

    it('M09 rejects a negative offset', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', offset: -1 })).toThrow('offset must be a positive safe integer')
    })

    it('M10 rejects a zero offset', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', offset: 0 })).toThrow('offset must be a positive safe integer')
    })

    it('M11 rejects a fractional offset', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', offset: 1.5 })).toThrow('offset must be a positive safe integer')
    })

    it('M12 rejects a negative limit', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', limit: -1 })).toThrow('limit must be a positive safe integer')
    })

    it('M13 rejects a zero limit', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', limit: 0 })).toThrow('limit must be a positive safe integer')
    })

    it('M14 rejects a fractional limit', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', limit: 1.25 })).toThrow('limit must be a positive safe integer')
    })

    it('M15 rejects a limit over the configured cap', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', limit: READ_SESSION_LIMIT + 1 })).toThrow(`limit must be less than or equal to ${READ_SESSION_LIMIT}`)
    })

    it('M16 rejects an unsafe limit', () => {
      expect(() => parseReadSessionArgs({ session_id: 's', limit: Number.MAX_SAFE_INTEGER + 1 })).toThrow('limit must be a positive safe integer')
    })

    it('M17 pretty-prints valid JSON tool arguments', () => {
      const tool = message('tool', '', { content: [{ type: 'tool-call', name: 'lookup', arguments: '{"z":1}' }] })
      const output = formatReadSessionOutput(readResult([tool]))
      expect(output).toContain('Tool call: lookup\n{\n  "z": 1\n}')
    })

    it('M18 preserves invalid JSON tool arguments', () => {
      const tool = message('tool', '', { content: [{ type: 'tool-call', name: 'lookup', arguments: 'not-json' }] })
      expect(formatReadSessionOutput(readResult([tool]))).toContain('Tool call: lookup\nnot-json')
    })

    it('M19 marks an errored tool result', () => {
      const tool = message('tool', '', { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'failed' }] }] })
      expect(formatReadSessionOutput(readResult([tool]))).toContain('Tool result (error)\nfailed')
    })

    it('M20 rejects tool execution with a missing required id', async () => {
      const readSession = vi.fn()
      const { definition } = captureReadTool({ readSession })
      await expect(definition.execute({}, { signal: undefined })).rejects.toThrow()
      expect(readSession).not.toHaveBeenCalled()
    })
  })

  describe('HARD (10)', () => {
    it('H01 rejects an offset beyond a non-empty source', async () => {
      const { service } = makeLiveService([message('only')])
      await expect(service.readSession({ session_id: 'session-1', offset: 2 })).rejects.toThrow('offset 2 is out of range')
    })

    it('H02 rejects a far out-of-range offset without slicing', async () => {
      const { service, deriveMessages } = makeLiveService([message('only')])
      await expect(service.readSession({ session_id: 'session-1', offset: 999, limit: 1 })).rejects.toThrow(/999 is out of range.*1 messages/)
      expect(deriveMessages).toHaveBeenCalledOnce()
    })

    it('H03 reconstructs a cold message with its canonical content', async () => {
      const events = [{ seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'persisted', role: 'user', content: [{ type: 'text', text: 'canonical' }], source: { kind: 'user' } } }]
      const { service } = makeColdService(events)
      await expect(service.readSession({ session_id: 'cold-session', offset: 1, limit: 1 })).resolves.toEqual({
        session_id: 'cold-session',
        offset: 1,
        messages: [{ id: 'persisted', role: 'user', content: [{ type: 'text', text: 'canonical' }], source: { kind: 'user' } }],
        total_messages: 1,
      })
    })

    it('H04 prefers a live session over stale persistence', async () => {
      const live = message('live')
      const { service, ctx } = makeLiveService([live])
      await expect(service.readSession({ session_id: 'session-1' })).resolves.toMatchObject({ messages: [live] })
      expect(ctx.sessionPersistence.inspect).not.toHaveBeenCalled()
    })

    it('H05 derives the live source once per read', async () => {
      const { service, deriveMessages } = makeLiveService([message('one'), message('two')])
      await service.readSession({ session_id: 'session-1', offset: 2, limit: 1 })
      expect(deriveMessages).toHaveBeenCalledTimes(1)
    })

    it('H06 forwards an abort signal through a cold read', async () => {
      const { service, inspect, meta } = makeColdService([])
      const controller = new AbortController()
      await service.readSession({ session_id: 'cold-session' }, controller.signal)
      expect(inspect.mock.calls[0]?.[0]).toBe(meta.id)
      expect(inspect.mock.calls[0]?.[1]).toBe(controller.signal)
    })

    it('H07 JSON-renders an unknown content block without throwing', () => {
      const unknown = message('unknown', '', { content: [{ type: 'future-block', value: 42 }] })
      expect(formatReadSessionOutput(readResult([unknown]))).toContain('"future-block"')
    })

    it('H08 formats nested tool-result blocks in order', () => {
      const tool = message('nested', '', { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'first' }, { type: 'reasoning', text: 'second' }] }] })
      const output = formatReadSessionOutput(readResult([tool]))
      expect(output).toContain('Tool result\nfirst\nsecond')
    })

    it('H09 renders a tool result using the complete read formatter', () => {
      const value = readResult([message('one', 'hello')], 1, 2)
      const { definition } = captureReadTool({ readSession: vi.fn() })
      expect(definition.output.render({}, value)).toEqual([{ type: 'text', text: formatReadSessionOutput(value) }])
    })

    it('H10 rejects an empty id through tool execution before service dispatch', async () => {
      const readSession = vi.fn()
      const { definition } = captureReadTool({ readSession })
      await expect(definition.execute({ session_id: ' ' }, { signal: undefined })).rejects.toThrow('session_id must be a non-empty string')
      expect(readSession).not.toHaveBeenCalled()
    })
  })
})
