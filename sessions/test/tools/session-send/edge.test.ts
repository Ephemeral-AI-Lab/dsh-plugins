import { describe, expect, it, vi } from 'vitest'
import { SessionSendService } from '../../../src/send-service.js'
import { registerSessionSendTool } from '../../../src/tools/session-send.js'

type Mode = 'steer' | 'followup'

interface LiveFixture {
  service: SessionSendService
  agent: { steer: ReturnType<typeof vi.fn>; followup: ReturnType<typeof vi.fn> }
  get: ReturnType<typeof vi.fn>
  persistence: { inspect: ReturnType<typeof vi.fn> }
}

interface ColdFixture {
  service: SessionSendService
  steer: ReturnType<typeof vi.fn>
  followup: ReturnType<typeof vi.fn>
  handle: { agent: { steer: ReturnType<typeof vi.fn>; followup: ReturnType<typeof vi.fn> }; dispose: ReturnType<typeof vi.fn> }
  get: ReturnType<typeof vi.fn>
  inspect: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
}

function makeLiveFixture(sessionId = 'live-session'): LiveFixture {
  const agent = { steer: vi.fn(), followup: vi.fn() }
  const get = vi.fn(() => agent)
  const persistence = { inspect: vi.fn() }
  return {
    service: new SessionSendService({ agents: { get }, sessionPersistence: persistence } as never),
    agent,
    get,
    persistence,
  }
}

function makeColdFixture(options: {
  sessionId?: string
  meta?: unknown
  events?: readonly unknown[]
  presets?: Record<string, unknown>
  parent?: {
    options: Record<string, unknown>
    presets?: Record<string, unknown>
  }
} = {}): ColdFixture & { parent?: { options: Record<string, unknown>; ctx: Record<string, unknown> } } {
  const steer = vi.fn()
  const followup = vi.fn()
  const handle = { agent: { steer, followup }, dispose: vi.fn(async () => {}) }
  const inspect = vi.fn(async () => ({ meta: options.meta ?? {}, events: options.events ?? [] }))
  const resume = vi.fn(async () => handle)
  const presets = options.presets
  const parentPresets = options.parent?.presets
  const owner = {
    agents: { resume },
    get: vi.fn((name: string) => name === 'agentPresets' ? presets : undefined),
  }
  const ctx = {
    agents: { get: vi.fn(() => undefined), resume },
    sessionPersistence: { inspect },
    get: vi.fn((name: string) => name === 'agentPresets' ? presets : undefined),
  }
  const fixture: ColdFixture & { parent?: { options: Record<string, unknown>; ctx: Record<string, unknown> } } = {
    service: new SessionSendService(ctx as never),
    steer,
    followup,
    handle,
    get: ctx.agents.get,
    inspect,
    resume,
  }
  if (options.parent !== undefined) {
    const parentCtx = {
      agents: owner.agents,
      get: vi.fn((name: string) => name === 'agentPresets' ? parentPresets : undefined),
    }
    fixture.parent = { options: options.parent.options, ctx: parentCtx }
  }
  return fixture
}

const easyCases: Array<{ name: string; message: string; mode?: Mode; sessionId?: string }> = [
  { name: 'plain text', message: 'hello' },
  { name: 'punctuation', message: 'ship it!' },
  { name: 'unicode text', message: '你好，世界' },
  { name: 'emoji text', message: '✅ continue 🚀' },
  { name: 'single character', message: 'x' },
  { name: 'numeric text', message: '0' },
  { name: 'boolean-looking text', message: 'false' },
  { name: 'json-looking text', message: '{"next":"step"}' },
  { name: 'markdown text', message: '**important** _detail_' },
  { name: 'code text', message: 'const answer = 42' },
  { name: 'url text', message: 'https://example.test/path?q=1' },
  { name: 'quoted text', message: 'say "hello" and \'bye\'' },
  { name: 'backslash text', message: String.raw`C:\work\task` },
  { name: 'newline text', message: 'first line\nsecond line' },
  { name: 'carriage return text', message: 'first\r\nsecond' },
  { name: 'tabbed text', message: 'left\tright' },
  { name: 'repeated spaces', message: 'many   spaces' },
  { name: 'surrounding spaces', message: '  preserve me  ' },
  { name: 'nonbreaking space', message: 'before\u00a0after' },
  { name: 'zero-width content', message: '  \u200b  ' },
  { name: 'slash command text', message: '/status --recent 5' },
  { name: 'explicit steer', message: 'steer now', mode: 'steer' },
  { name: 'explicit followup', message: 'queue next turn', mode: 'followup' },
  { name: 'undefined mode', message: 'use default', mode: undefined },
  { name: 'mixed language', message: '继续 working الآن' },
  { name: 'long bounded text', message: 'a'.repeat(512) },
  { name: 'parentheses', message: '(retry this part)' },
  { name: 'ampersand', message: 'a && b || c' },
  { name: 'asterisk', message: '***' },
  { name: 'session id whitespace', message: 'trim the id', sessionId: '  live-session  ' },
]

describe('session_send edge cases — EASY (30)', () => {
  it.each(easyCases)('delivers $name to the expected lane', async ({ message, mode, sessionId }) => {
    const fixture = makeLiveFixture()
    const args = { session_id: sessionId ?? 'live-session', message, ...mode === undefined ? {} : { mode } }

    const result = await fixture.service.send(args)

    expect(result.message_id).toEqual(expect.any(String))
    const target = mode === 'followup' ? fixture.agent.followup : fixture.agent.steer
    expect(target).toHaveBeenCalledOnce()
    expect(target).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: [{ type: 'text', text: message }],
      source: { kind: 'user' },
    }))
    const other = mode === 'followup' ? fixture.agent.steer : fixture.agent.followup
    expect(other).not.toHaveBeenCalled()
  })
})

describe('session_send edge cases — MEDIUM (20)', () => {
  it('rejects a missing session id before looking up an agent', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ message: 'hello' } as never)).rejects.toThrow('session_id must be a non-empty string')
    expect(fixture.get).not.toHaveBeenCalled()
  })

  it('rejects an empty session id', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: '', message: 'hello' })).rejects.toThrow('session_id must be a non-empty string')
  })

  it('rejects a whitespace-only session id', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: '   ', message: 'hello' })).rejects.toThrow('session_id must be a non-empty string')
  })

  it('rejects a missing message', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session' } as never)).rejects.toThrow('message must be a non-empty string')
  })

  it('rejects an empty message', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session', message: '' })).rejects.toThrow('message must be a non-empty string')
  })

  it('rejects a whitespace-only message', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session', message: ' \t\n' })).rejects.toThrow('message must be a non-empty string')
  })

  it('rejects a non-string session id', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 42, message: 'hello' } as never)).rejects.toThrow('session_id must be a non-empty string')
  })

  it('rejects a non-string message', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session', message: 42 } as never)).rejects.toThrow('message must be a non-empty string')
  })

  it('rejects a null mode', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session', message: 'hello', mode: null } as never)).rejects.toThrow('mode must be either steer or followup')
  })

  it('rejects an unknown mode', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session', message: 'hello', mode: 'broadcast' } as never)).rejects.toThrow('mode must be either steer or followup')
  })

  it('rejects an uppercase mode', async () => {
    const fixture = makeLiveFixture()
    await expect(fixture.service.send({ session_id: 'live-session', message: 'hello', mode: 'STEER' } as never)).rejects.toThrow('mode must be either steer or followup')
  })

  it('does not dispatch an already-aborted live request', async () => {
    const fixture = makeLiveFixture()
    const controller = new AbortController()
    controller.abort()
    await expect(fixture.service.send({ session_id: 'live-session', message: 'hello' }, undefined, controller.signal)).rejects.toThrow()
    expect(fixture.agent.steer).not.toHaveBeenCalled()
  })

  it('resumes a cold session with default steer', async () => {
    const fixture = makeColdFixture()
    await fixture.service.send({ session_id: 'cold-session', message: 'wake up' })
    expect(fixture.resume).toHaveBeenCalledWith({ resumeSessionId: 'cold-session' })
    expect(fixture.steer).toHaveBeenCalledOnce()
    expect(fixture.followup).not.toHaveBeenCalled()
  })

  it('resumes a cold session with followup when requested', async () => {
    const fixture = makeColdFixture()
    await fixture.service.send({ session_id: 'cold-session', message: 'next turn', mode: 'followup' })
    expect(fixture.followup).toHaveBeenCalledOnce()
    expect(fixture.steer).not.toHaveBeenCalled()
  })

  it('forwards the caller signal to cold-session inspection', async () => {
    const fixture = makeColdFixture()
    const signal = new AbortController().signal
    await fixture.service.send({ session_id: 'cold-session', message: 'inspect first' }, undefined, signal)
    expect(fixture.inspect).toHaveBeenCalledWith('cold-session', signal)
  })

  it('mounts the preset stored in the cold session header', async () => {
    const mount = vi.fn(async () => {})
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'default' }))
    const fixture = makeColdFixture({ meta: { agentPreset: 'coding' }, presets: { resolve, mount } })
    await fixture.service.send({ session_id: 'cold-session', message: 'resume coding' })
    const setup = fixture.resume.mock.calls[0]?.[0]?.setup as ((ctx: object) => Promise<void>)
    const childContext = {}
    await setup(childContext)
    expect(resolve).toHaveBeenCalledWith('coding')
    expect(mount).toHaveBeenCalledWith(childContext, 'coding')
  })

  it('uses the latest selected preset event over the header', async () => {
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'default' }))
    const mount = vi.fn(async () => {})
    const fixture = makeColdFixture({
      meta: { agentPreset: 'header-preset' },
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'old-preset' } },
        { type: 'agent-preset/selected', data: { agentPreset: 'new-preset' } },
      ],
      presets: { resolve, mount },
    })
    await fixture.service.send({ session_id: 'cold-session', message: 'use latest' })
    expect(resolve).toHaveBeenCalledWith('new-preset')
  })

  it('forwards parent agent options when waking a cold child', async () => {
    const fixture = makeColdFixture({ parent: { options: { provider: 'p', model: 'm' } } })
    await fixture.service.send({ session_id: 'cold-session', message: 'wake child' }, { options: fixture.parent!.options, ctx: fixture.parent!.ctx } as never)
    expect(fixture.resume).toHaveBeenCalledWith({
      resumeSessionId: 'cold-session',
      agentOptions: fixture.parent!.options,
    })
  })

  it('reuses a matching parent composition when waking a cold child', async () => {
    const composeFrom = vi.fn()
    const fixture = makeColdFixture({
      events: [{ type: 'agent-preset/selected', data: { agentPreset: 'same' } }],
      parent: {
        options: { provider: 'p', model: 'm' },
        presets: { composedPreset: vi.fn(() => 'same'), composeFrom },
      },
    })
    await fixture.service.send({ session_id: 'cold-session', message: 'reuse composition' }, { options: fixture.parent!.options, ctx: fixture.parent!.ctx } as never)
    const setup = fixture.resume.mock.calls[0]?.[0]?.setup as ((ctx: object) => Promise<void>)
    const childContext = {}
    await setup(childContext)
    expect(composeFrom).toHaveBeenCalledWith(childContext, fixture.parent!.ctx)
  })

  it('registers a session_send tool with steer as the schema default', async () => {
    const registered: Array<{ name: string; parameters: Record<string, unknown>; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const service = { send: vi.fn(async () => ({ message_id: 'tool-message' })) }
    const dispose = registerSessionSendTool({
      tools: {
        register(definition: typeof registered[number]) {
          registered.push(definition)
          return () => {}
        },
      },
    } as never, service as never)
    expect(registered).toHaveLength(1)
    expect(registered[0]!.name).toBe('session_send')
    expect(registered[0]!.parameters).toMatchObject({ properties: { mode: { default: 'steer', enum: ['steer', 'followup'] } } })
    dispose()
    expect(service.send).not.toHaveBeenCalled()
  })
})

describe('session_send edge cases — HARD (10)', () => {
  it('does not resume when cold-session inspection fails', async () => {
    const fixture = makeColdFixture()
    const error = new Error('persistence unavailable')
    fixture.inspect.mockRejectedValueOnce(error)
    await expect(fixture.service.send({ session_id: 'cold-session', message: 'try once' })).rejects.toBe(error)
    expect(fixture.resume).not.toHaveBeenCalled()
  })

  it('propagates a resume failure without dispatching', async () => {
    const fixture = makeColdFixture()
    fixture.resume.mockRejectedValueOnce(new Error('resume failed'))
    await expect(fixture.service.send({ session_id: 'cold-session', message: 'try resume' })).rejects.toThrow('resume failed')
    expect(fixture.steer).not.toHaveBeenCalled()
  })

  it('disposes a resumed handle when steer throws', async () => {
    const fixture = makeColdFixture()
    fixture.steer.mockImplementationOnce(() => { throw new Error('steer failed') })
    await expect(fixture.service.send({ session_id: 'cold-session', message: 'fail steer' })).rejects.toThrow('steer failed')
    expect(fixture.handle.dispose).toHaveBeenCalledOnce()
  })

  it('disposes a resumed handle when followup throws', async () => {
    const fixture = makeColdFixture()
    fixture.followup.mockImplementationOnce(() => { throw new Error('followup failed') })
    await expect(fixture.service.send({ session_id: 'cold-session', message: 'fail followup', mode: 'followup' })).rejects.toThrow('followup failed')
    expect(fixture.handle.dispose).toHaveBeenCalledOnce()
  })

  it('disposes a resumed handle when cancellation arrives before dispatch', async () => {
    const fixture = makeColdFixture()
    const controller = new AbortController()
    fixture.resume.mockImplementationOnce(async () => {
      controller.abort()
      return fixture.handle
    })
    await expect(fixture.service.send({ session_id: 'cold-session', message: 'cancel me' }, undefined, controller.signal)).rejects.toThrow()
    expect(fixture.handle.dispose).toHaveBeenCalledOnce()
    expect(fixture.steer).not.toHaveBeenCalled()
  })

  it('disposes every owned resumed handle and is idempotent', async () => {
    const first = makeColdFixture()
    const second = makeColdFixture()
    const handles = [first.handle, second.handle]
    let index = 0
    const service = new SessionSendService({
      agents: { get: vi.fn(() => undefined), resume: vi.fn(async () => handles[index++]!) },
      sessionPersistence: { inspect: vi.fn(async () => ({ meta: {}, events: [] })) },
      get: vi.fn(() => undefined),
    } as never)
    await service.send({ session_id: 'first', message: 'one' })
    await service.send({ session_id: 'second', message: 'two' })
    await service.dispose()
    await service.dispose()
    expect(first.handle.dispose).toHaveBeenCalledOnce()
    expect(second.handle.dispose).toHaveBeenCalledOnce()
  })

  it('falls back to an earlier valid preset event when a later event is malformed', async () => {
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'default' }))
    const mount = vi.fn(async () => {})
    const fixture = makeColdFixture({
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'valid' } },
        { type: 'agent-preset/selected', data: { agentPreset: 123 } },
      ],
      presets: { resolve, mount },
    })
    await fixture.service.send({ session_id: 'cold-session', message: 'fallback preset' })
    expect(resolve).toHaveBeenCalledWith('valid')
  })

  it('uses the header preset when no selected event exists', async () => {
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'default' }))
    const mount = vi.fn(async () => {})
    const fixture = makeColdFixture({ meta: { agentPreset: 'header-only' }, presets: { resolve, mount } })
    await fixture.service.send({ session_id: 'cold-session', message: 'header preset' })
    expect(resolve).toHaveBeenCalledWith('header-only')
  })

  it('passes the agent and signal through the session_send tool boundary', async () => {
    let definition: { execute: (args: unknown, exec: { agent?: unknown; signal: AbortSignal }) => Promise<unknown> } | undefined
    const service = { send: vi.fn(async () => ({ message_id: 'boundary-message' })) }
    registerSessionSendTool({
      tools: {
        register(candidate: typeof definition) {
          definition = candidate
          return () => {}
        },
      },
    } as never, service as never)
    const agent = { id: 'parent-agent' }
    const signal = new AbortController().signal
    const args = { session_id: 's', message: 'through tool', mode: 'followup' }
    await expect(definition!.execute(args, { agent, signal })).resolves.toEqual({ message_id: 'boundary-message' })
    expect(service.send).toHaveBeenCalledWith(args, agent, signal)
  })

  it('renders the tool result as one JSON text block', async () => {
    let definition: { output: { render: (args: unknown, value: unknown) => unknown } } | undefined
    registerSessionSendTool({
      tools: {
        register(candidate: typeof definition) {
          definition = candidate
          return () => {}
        },
      },
    } as never, { send: vi.fn() } as never)
    expect(definition!.output.render({}, { message_id: 'rendered' })).toEqual([
      { type: 'text', text: '{"message_id":"rendered"}' },
    ])
  })
})
