import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise(resolve => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

describe('mock plugin lifecycle', () => {
  it('registers mock and removes it with the owning context', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(CommandRuntime)
    apply(ctx)
    const llm = ctx.llm
    expect(llm.listProviders()).toEqual([{ id: 'mock', name: 'Mock' }])
    expect(ctx.commands.list({ id: 'test', session: undefined } as never)).toEqual([
      expect.objectContaining({ name: 'mock' }),
    ])
    // The slash-command route is internal plumbing, not a selectable model.
    await expect(llm.listModels('mock')).resolves.toEqual([])
    await expect(llm.resolveModelInfo('mock', 'mock')).resolves.toMatchObject({
      provider: 'mock',
      id: 'mock',
      name: 'Deterministic Mock Model',
    })
    await ctx.fiber.dispose()
    expect(llm.listProviders()).toEqual([])
  })

  it('persists pre-start replay failures into the session projection log', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: 'plugin test' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    apply(ctx)
    const agent = ctx.agentLoop.create(SessionId('prestart-failure'), { provider: 'mock', model: 'mock' })
    try {
      const idle = waitForIdle(ctx, agent)
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: '/mock replay C:/does-not-exist/mock.jsonl' }],
        source: { kind: 'user' },
      }))
      await idle

      const failure = [...agent.session.events].reverse().find(event => event.type === 'mock/status')
      expect(failure?.data).toMatchObject({
        sessionId: 'prestart-failure',
        phase: 'failed',
      })
      expect(failure?.data.errorMessage).toContain('does-not-exist')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
