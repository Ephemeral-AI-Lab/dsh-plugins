import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, vi } from 'vitest'
import { apply as applyLoop } from '../src/index.js'

export type TestAgent = Agent & { status: Agent['status'] }
export type AgentHandle = { agent: TestAgent; session: Session; detach: () => void; disposeScope: () => Promise<void> }

let callCounter = 0

export async function createHarness() {
  const ctx = new Context()
  const fibers = []
  for (const plugin of [SessionStore, SessionProjection, AgentRegistry, SystemPrompt, ToolRuntime, CommandRuntime]) fibers.push(await ctx.plugin(plugin))

  let agentOwnerCtx!: Context
  fibers.push(await ctx.plugin({
    name: 'test-agent-owner',
    inject: ['tools'],
    apply(ownerCtx) {
      agentOwnerCtx = ownerCtx
    },
  }))

  const flushes: string[] = []
  let flushFailures = 0
  let failFlush = false
  let failFlushAt: number | undefined
  let blockedFlush: Promise<void> | undefined
  let releaseBlockedFlush: (() => void) | undefined
  const host = await ctx.plugin({
    name: 'test-host',
    inject: ['tools', 'commands', 'agents', 'sessions', 'sessionProjections'],
    apply(hostCtx) {
      hostCtx.on('session/flush', async session => {
        flushes.push(session.id)
        if (blockedFlush !== undefined) await blockedFlush
        if (failFlush || flushes.length === failFlushAt) {
          flushFailures += 1
          throw new Error('fake persistence failure')
        }
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
      send: vi.fn(),
      followup: vi.fn(),
      steer: vi.fn(),
    } as unknown as TestAgent
    // Match dsh-agent-loop: real agent scopes inject tools, but not commands.
    const scope = createScope(agentOwnerCtx, agent)
    agent.ctx = scope.ctx
    const detach = ctx.agents.register(agent)
    return { agent, session, detach, disposeScope: scope.dispose }
  }

  return {
    ctx,
    flushes,
    get flushFailures() {
      return flushFailures
    },
    setFailFlush(value: boolean) {
      failFlush = value
      if (!value) failFlushAt = undefined
    },
    failPostDispatchFlush() {
      failFlushAt = flushes.length + 2
    },
    blockNextFlush() {
      if (blockedFlush !== undefined) throw new Error('a flush is already blocked')
      blockedFlush = new Promise<void>(resolve => {
        releaseBlockedFlush = resolve
      })
    },
    releaseBlockedFlush() {
      const release = releaseBlockedFlush
      blockedFlush = undefined
      releaseBlockedFlush = undefined
      release?.()
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

export async function disposeAgent(handle: AgentHandle): Promise<void> {
  handle.detach()
  await handle.disposeScope()
}

export async function callTool(
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

export async function callCommand(ctx: Context, agent: TestAgent, line: string) {
  const commandAgent = agent as unknown as Parameters<typeof ctx.commands.execute>[0]
  return ctx.commands.execute(commandAgent, line, new AbortController().signal)
}

afterEach(() => {
  vi.useRealTimers()
})
