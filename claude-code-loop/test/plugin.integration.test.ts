import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerLoopCommand } from '../src/commands.js'
import { apply as applyLoop } from '../src/index.js'

type TestAgent = Agent & { status: Agent['status'] }
type AgentHandle = { agent: TestAgent; session: Session; detach: () => void; disposeScope: () => Promise<void> }
let callCounter = 0

async function createHarness() {
  const ctx = new Context()
  const fibers = []
  for (const plugin of [SessionStore, AgentRegistry, SystemPrompt, ToolRuntime, CommandRuntime]) fibers.push(await ctx.plugin(plugin))

  const flushes: string[] = []
  let failFlush = false
  const host = await ctx.plugin({
    name: 'test-host',
    inject: ['tools', 'commands', 'agents', 'sessions'],
    apply(hostCtx) {
      hostCtx.on('session/flush', session => {
        flushes.push(session.id)
        if (failFlush) throw new Error('fake persistence failure')
        return true
      })
      applyLoop(hostCtx)
    },
  })
  fibers.push(host)
  let loopDisposed = false

  const makeAgent = (id: string, status: TestAgent['status'], session = ctx.sessions.create(id)): AgentHandle => {
    const agent = {
      id,
      session,
      status,
      ctx: undefined,
      followup: vi.fn(),
      steer: vi.fn(),
    } as unknown as TestAgent
    const scope = createScope(host.ctx, agent)
    agent.ctx = scope.ctx
    const detach = ctx.agents.register(agent)
    return { agent, session, detach, disposeScope: scope.dispose }
  }

  return {
    ctx,
    flushes,
    setFailFlush(value: boolean) {
      failFlush = value
    },
    makeAgent,
    async dispose() {
      if (!loopDisposed) {
        loopDisposed = true
        await host.dispose()
      }
      for (const fiber of fibers.slice(0, -1).reverse()) await fiber.dispose()
    },
    async disposeLoop() {
      if (loopDisposed) return
      loopDisposed = true
      await host.dispose()
    },
  }
}

async function disposeAgent(handle: AgentHandle): Promise<void> {
  handle.detach()
  await handle.disposeScope()
}

async function callTool(
  ctx: Context,
  agent: TestAgent,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<{ isError: boolean; value?: any; error?: { message: string } }> {
  return ctx.tools.execute({
    callId: `${name}-${++callCounter}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })
}

async function callCommand(ctx: Context, agent: TestAgent, line: string) {
  const commandAgent = agent as unknown as Parameters<typeof ctx.commands.execute>[0]
  return ctx.commands.execute(commandAgent, line, new AbortController().signal)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('claude-code-loop host integration', () => {
  it('registers real scoped tools and keeps loop state session-local', async () => {
    const harness = await createHarness()
    const first = harness.makeAgent('session-a', 'idle')
    const second = harness.makeAgent('session-b', 'idle')
    try {
      const created = await callTool(harness.ctx, first.agent, 'loop_create', {
        prompt: '  check status  ',
        time_in_seconds: 60,
      })
      expect(created.isError).toBe(false)
      expect(created.value.prompt).toBe('check status')
      expect(created.value.allow_steer).toBe(true)
      expect(harness.ctx.tools.get('loop_create')).toBeUndefined()
      expect(first.agent.ctx.tools.get('loop_create', first.agent)).toBeDefined()
      expect(second.agent.ctx.tools.get('loop_create', second.agent)).toBeDefined()

      const firstList = await callTool(harness.ctx, first.agent, 'loop_list', {})
      const secondList = await callTool(harness.ctx, second.agent, 'loop_list', {})
      expect(firstList.value).toHaveLength(1)
      expect(secondList.value).toEqual([])

      const deleted = await callTool(harness.ctx, first.agent, 'loop_delete', { id: created.value.id })
      expect(deleted).toMatchObject({ isError: false, value: { deleted: true, id: created.value.id } })
      expect((await callTool(harness.ctx, first.agent, 'loop_list', {})).value).toEqual([])
      expect(harness.flushes.length).toBeGreaterThan(0)
    } finally {
      await disposeAgent(second)
      await disposeAgent(first)
      await harness.dispose()
    }
  })

  it('uses fake timers to deliver steer/followup and skips missed intervals', async () => {
    vi.useFakeTimers({ now: 0 })
    const harness = await createHarness()
    const running = harness.makeAgent('running', 'running')
    const idle = harness.makeAgent('idle', 'idle')
    try {
      const steerLoop = await callTool(harness.ctx, running.agent, 'loop_create', { prompt: 'tick', time_in_seconds: 1 })
      const followupLoop = await callTool(harness.ctx, idle.agent, 'loop_create', { prompt: 'idle tick', time_in_seconds: 1 })
      expect(steerLoop.isError).toBe(false)
      expect(followupLoop.isError).toBe(false)

      await vi.advanceTimersByTimeAsync(999)
      expect(running.agent.steer).not.toHaveBeenCalled()
      expect(idle.agent.followup).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(running.agent.steer).toHaveBeenCalledTimes(1)
      expect(idle.agent.followup).toHaveBeenCalledTimes(1)
      expect(running.agent.steer.mock.calls[0]?.[0]).toMatchObject({
        content: [{ type: 'text', text: 'tick' }],
        source: { kind: 'plugin', plugin: 'claude-code-loop' },
      })

      await vi.advanceTimersByTimeAsync(2_500)
      expect(running.agent.steer).toHaveBeenCalledTimes(3)
      expect(idle.agent.followup).toHaveBeenCalledTimes(3)
    } finally {
      await disposeAgent(idle)
      await disposeAgent(running)
      await harness.dispose()
    }
  })

  it('dispatches multiple due loops in next_at order', async () => {
    vi.useFakeTimers({ now: 0 })
    const harness = await createHarness()
    const agent = harness.makeAgent('ordered', 'idle')
    try {
      const first = await callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'first', time_in_seconds: 1 })
      const second = await callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'second', time_in_seconds: 1 })
      expect(first.isError).toBe(false)
      expect(second.isError).toBe(false)

      await vi.advanceTimersByTimeAsync(1_000)

      expect(agent.agent.followup.mock.calls.map(([message]) => message.content[0]?.text)).toEqual(['first', 'second'])
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('recreates a timer from the session log when an agent is replaced', async () => {
    vi.useFakeTimers({ now: 0 })
    const harness = await createHarness()
    const first = harness.makeAgent('resume', 'idle')
    try {
      const created = await callTool(harness.ctx, first.agent, 'loop_create', { prompt: 'resume me', time_in_seconds: 1 })
      expect(created.isError).toBe(false)
      const session = first.session
      await disposeAgent(first)

      const resumed = harness.makeAgent('resume', 'idle', session)
      try {
        await vi.advanceTimersByTimeAsync(1_000)
        expect(resumed.agent.followup).toHaveBeenCalledTimes(1)
        expect(first.agent.followup).not.toHaveBeenCalled()
        expect(session.events.filter(event => event.type === 'loop/change')).toHaveLength(2)
      } finally {
        await disposeAgent(resumed)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('rejects invalid creates before appending and surfaces persistence failure', async () => {
    const harness = await createHarness()
    const agent = harness.makeAgent('validation', 'idle')
    try {
      const invalid = await callTool(harness.ctx, agent.agent, 'loop_create', { prompt: ' ', time_in_seconds: 0 })
      expect(invalid.isError).toBe(true)
      expect(agent.session.events.some(event => event.type === 'loop/change')).toBe(false)

      harness.setFailFlush(true)
      const failed = await callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'will not persist', time_in_seconds: 1 })
      expect(failed).toMatchObject({ isError: true, error: { message: 'fake persistence failure' } })
      expect(agent.session.events.some(event => event.type === 'loop/change')).toBe(false)
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('exposes /loop and delegates create/list/delete to the scoped tools', async () => {
    const harness = await createHarness()
    const first = harness.makeAgent('command-a', 'idle')
    const second = harness.makeAgent('command-b', 'idle')
    try {
      const created = await callCommand(harness.ctx, first.agent, '/loop 60  check status  ')
      expect(created?.result.kind).toBe('success')
      const createdView = JSON.parse(created?.result.kind === 'success' ? created.result.text ?? '' : '')
      expect(createdView).toMatchObject({ prompt: 'check status', time_in_seconds: 60 })

      const run = first.session.events.find(event => event.type === 'command/run')
      expect(run?.data).toMatchObject({ name: 'loop' })
      expect((run?.data as { args?: string }).args).toBeUndefined()

      const listed = await callCommand(harness.ctx, first.agent, '/loop list')
      expect(JSON.parse(listed?.result.kind === 'success' ? listed.result.text ?? '' : '')).toHaveLength(1)
      const secondListed = await callCommand(harness.ctx, second.agent, '/loop list')
      expect(JSON.parse(secondListed?.result.kind === 'success' ? secondListed.result.text ?? '' : '')).toEqual([])

      const deleted = await callCommand(harness.ctx, first.agent, `/loop delete ${createdView.id}`)
      expect(deleted?.result).toMatchObject({ kind: 'success', text: JSON.stringify({ deleted: true, id: createdView.id }) })
      const remaining = await callCommand(harness.ctx, first.agent, '/loop list')
      expect(JSON.parse(remaining?.result.kind === 'success' ? remaining.result.text ?? '' : '')).toEqual([])
    } finally {
      await disposeAgent(second)
      await disposeAgent(first)
      await harness.dispose()
    }
  })

  it('delivers a command-created loop through the normal fake-timer runtime', async () => {
    vi.useFakeTimers({ now: 0 })
    const harness = await createHarness()
    const agent = harness.makeAgent('command-delivery', 'idle')
    try {
      const created = await callCommand(harness.ctx, agent.agent, '/loop 1 remind me')
      expect(created?.result.kind).toBe('success')

      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.followup).toHaveBeenCalledTimes(1)
      expect(agent.agent.followup.mock.calls[0]?.[0]).toMatchObject({
        content: [{ type: 'text', text: 'remind me' }],
        source: { kind: 'plugin', plugin: 'claude-code-loop' },
      })
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('returns command usage errors without writing loop state', async () => {
    const harness = await createHarness()
    const agent = harness.makeAgent('command-validation', 'idle')
    try {
      const invalid = await callCommand(harness.ctx, agent.agent, '/loop list extra')
      expect(invalid?.result).toEqual({
        kind: 'error',
        text: 'Usage: /loop <seconds> <prompt> | /loop list | /loop delete <id>',
      })
      expect(agent.session.events.some(event => event.type === 'loop/change')).toBe(false)

      for (const line of ['/loop', '/loop delete', '/loop delete ', '/loop 1', '/loop nonsense']) {
        expect((await callCommand(harness.ctx, agent.agent, line))?.result).toEqual({
          kind: 'error',
          text: 'Usage: /loop <seconds> <prompt> | /loop list | /loop delete <id>',
        })
      }

      const missing = await callCommand(harness.ctx, agent.agent, '/loop delete missing')
      expect(missing?.result.kind).toBe('error')
      expect(missing?.result.text).toContain('unknown loop id')
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('falls back to the tool value when a command result has no text block', async () => {
    let handler!: (input: { commandId: string; rawInput: string; signal: AbortSignal }) => Promise<unknown>
    const commandCtx = {
      commands: {
        register(definition: { handler: typeof handler }) {
          handler = definition.handler
          return () => undefined
        },
      },
    } as never
    const rootCtx = {
      tools: {
        execute: vi.fn(async () => ({ isError: false, content: [], value: { fallback: true } })),
      },
    } as never
    const dispose = registerLoopCommand(rootCtx, commandCtx, {} as never)

    await expect(handler({ commandId: 'fallback', rawInput: 'list', signal: new AbortController().signal })).resolves.toEqual({
      kind: 'success',
      text: JSON.stringify({ fallback: true }),
    })
    dispose()
  })

  it('publishes the exact v1 tool schemas at the real agent boundary', async () => {
    const harness = await createHarness()
    const agent = harness.makeAgent('schema', 'idle')
    try {
      const create = agent.agent.ctx.tools.get('loop_create', agent.agent)
      const list = agent.agent.ctx.tools.get('loop_list', agent.agent)
      const del = agent.agent.ctx.tools.get('loop_delete', agent.agent)

      expect([create?.name, list?.name, del?.name]).toEqual(['loop_create', 'loop_list', 'loop_delete'])
      expect(create?.description).toContain('time_in_seconds is the only time unit')
      expect(create?.parameters).toMatchObject({
        properties: {
          prompt: { type: 'string' },
          time_in_seconds: { type: 'integer' },
          allow_steer: { type: 'boolean' },
        },
        required: ['prompt', 'time_in_seconds'],
      })
      expect(create?.parameters.properties).not.toHaveProperty('minutes')
      expect(create?.parameters.properties).not.toHaveProperty('session_id')
      expect(list?.parameters).toMatchObject({ type: 'object', properties: {} })
      expect(del?.parameters).toMatchObject({
        properties: { id: { type: 'string' } },
        required: ['id'],
      })
      expect(create?.output?.schema).toMatchObject({
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          time_in_seconds: { type: 'integer' },
          allow_steer: { type: 'boolean' },
          next_at: { type: 'integer' },
          state: { enum: ['scheduled', 'overdue'] },
          delivery_mode: { enum: ['session-local'] },
        },
      })
      expect(create?.output?.render?.({}, undefined)).toEqual([{ type: 'text', text: 'null' }])
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('rejects invalid tool inputs before writing loop events', async () => {
    const harness = await createHarness()
    const agent = harness.makeAgent('tool-validation', 'idle')
    const invalidCreates: Record<string, unknown>[] = [
      {},
      { prompt: ' ', time_in_seconds: 1 },
      { prompt: 'check', time_in_seconds: 0 },
      { prompt: 'check', time_in_seconds: -1 },
      { prompt: 'check', time_in_seconds: 1.5 },
      { prompt: 'check', time_in_seconds: Number.NaN },
      { prompt: 'check', time_in_seconds: Number.POSITIVE_INFINITY },
      { prompt: 'check', time_in_seconds: Number.MAX_SAFE_INTEGER + 1 },
      { prompt: 'check', time_in_seconds: 1, allow_steer: 'yes' },
    ]
    try {
      for (const arguments_ of invalidCreates) {
        expect((await callTool(harness.ctx, agent.agent, 'loop_create', arguments_)).isError, JSON.stringify(arguments_)).toBe(true)
      }
      expect((await callTool(harness.ctx, agent.agent, 'loop_delete', { id: ' ' })).isError).toBe(true)
      expect((await callTool(harness.ctx, agent.agent, 'loop_delete', { id: 'missing' })).isError).toBe(true)
      expect(agent.session.events.filter(event => event.type === 'loop/change')).toEqual([])
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('preserves allow_steer false and emits the complete session-local view', async () => {
    const harness = await createHarness()
    const agent = harness.makeAgent('view', 'idle')
    try {
      const created = await callTool(harness.ctx, agent.agent, 'loop_create', {
        prompt: 'check once',
        time_in_seconds: 5,
        allow_steer: false,
      })
      expect(created).toMatchObject({ isError: false, value: {
        prompt: 'check once',
        time_in_seconds: 5,
        allow_steer: false,
        state: 'scheduled',
        delivery_mode: 'session-local',
      } })
      expect(JSON.parse(created.content?.[0]?.text ?? '')).toMatchObject({ delivery_mode: 'session-local' })
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('serializes concurrent creates and deletes without crossing loop ids', async () => {
    const harness = await createHarness()
    const agent = harness.makeAgent('concurrency', 'idle')
    try {
      const created = await Promise.all([
        callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'first', time_in_seconds: 10 }),
        callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'second', time_in_seconds: 20 }),
      ])
      expect(created.every(result => !result.isError)).toBe(true)
      const ids = created.map(result => result.value.id)
      expect(new Set(ids).size).toBe(2)
      expect((await callTool(harness.ctx, agent.agent, 'loop_list', {})).value).toHaveLength(2)

      await Promise.all(ids.map(id => callTool(harness.ctx, agent.agent, 'loop_delete', { id })))
      expect((await callTool(harness.ctx, agent.agent, 'loop_list', {})).value).toEqual([])
      expect(agent.session.events.filter(event => event.type === 'loop/change')).toHaveLength(4)
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })

  it('does not install loop tools on a child agent', async () => {
    const harness = await createHarness()
    const root = harness.makeAgent('root', 'idle')
    const childAgent = {
      id: 'child',
      session: harness.ctx.sessions.create('child'),
      status: 'idle',
      ctx: undefined,
      followup: vi.fn(),
      steer: vi.fn(),
    } as unknown as TestAgent
    const childScope = createScope(root.agent.ctx, childAgent)
    childAgent.ctx = childScope.ctx
    const detachChild = root.agent.ctx.agents.enter(childAgent, root.agent)
    root.agent.ctx.agents.announce(childAgent)
    try {
      expect(root.agent.ctx.tools.get('loop_create', root.agent)).toBeDefined()
      expect(childAgent.ctx.tools.get('loop_create', childAgent)).toBeUndefined()
    } finally {
      detachChild()
      await childScope.dispose()
      await disposeAgent(root)
      await harness.dispose()
    }
  })

  it('cleans scoped tools and timers when the agent is disposed', async () => {
    vi.useFakeTimers({ now: 0 })
    const harness = await createHarness()
    const agent = harness.makeAgent('stale', 'idle')
    try {
      const created = await callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'stale', time_in_seconds: 1 })
      expect(created.isError).toBe(false)
      await disposeAgent(agent)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(agent.agent.followup).not.toHaveBeenCalled()
      expect(harness.ctx.agents.get('stale')).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })

  it('removes all attached tools when the plugin is disposed', async () => {
    const harness = await createHarness()
    const first = harness.makeAgent('dispose-a', 'idle')
    const second = harness.makeAgent('dispose-b', 'idle')
    try {
      expect(first.agent.ctx.tools.get('loop_create', first.agent)).toBeDefined()
      expect(second.agent.ctx.tools.get('loop_delete', second.agent)).toBeDefined()
      await harness.disposeLoop()
      expect(harness.ctx.tools.get('loop_create', first.agent)).toBeUndefined()
      expect(harness.ctx.tools.get('loop_list', second.agent)).toBeUndefined()
      await harness.dispose()
    } finally {
      // The harness owns the core fibers after the explicit plugin disposal.
    }
  })

  it('reports dispatch persistence failure without falsely advancing durable state', async () => {
    vi.useFakeTimers({ now: 0 })
    const harness = await createHarness()
    const agent = harness.makeAgent('dispatch-failure', 'idle')
    try {
      const created = await callTool(harness.ctx, agent.agent, 'loop_create', { prompt: 'retry me', time_in_seconds: 1 })
      expect(created.isError).toBe(false)
      harness.setFailFlush(true)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.followup).not.toHaveBeenCalled()
      expect(agent.session.events.filter(event => event.type === 'loop/change')).toHaveLength(1)
    } finally {
      await disposeAgent(agent)
      await harness.dispose()
    }
  })
})
