/** Native Agent, preset, persistence and Team services for plugin integration tests. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as plugin from '../src/index.ts'

class Query extends SessionQuery {
  override async searchSessions(): Promise<never> { throw new Error('Not used') }
  override async searchEvents(): Promise<never> { throw new Error('Not used') }
}
class Adapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Working' }
    await new Promise<void>(resolve => {
      if (options.signal?.aborted) resolve()
      else options.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    throw new Error('Fixture request cancelled')
  }
}

export async function fixture() {
  const ctx = new Context()
  const root = mkdtempSync(join(tmpdir(), 'mayfly-team-plugin-'))
  try {
    ctx.baseUrl = new URL('../', import.meta.url).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Persistence, { root })
    await ctx.plugin(Query)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Presets, { default: 'standard' })
    for (const id of ['standard', 'minimal', 'ptc', 'cordis', 'mayfly-cordis', 'team']) {
      const dispose = await ctx.agentPresets.register({ id, plugins: [] })
      ctx.effect(() => dispose)
    }
    await ctx.plugin(Subagents)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(fork, { providerName: 'fork' })
    await ctx.plugin(TeamService, { maxMembers: 8 })
    ctx.llm.registerAdapter(['mock'], new Adapter())
    const factsListeners = new Set<(children: readonly unknown[]) => void>()
    let factsChildren: readonly unknown[] = []
    class Facts extends Service {
      constructor(context: Context) { super(context, 'mayflySessionFacts') }
      subscribeChildren(listener: (children: readonly unknown[]) => void) {
        factsListeners.add(listener)
        listener(factsChildren)
        return () => factsListeners.delete(listener)
      }
    }
    new Facts(ctx)
    const publishFacts = (children: readonly unknown[]) => {
      factsChildren = children
      for (const listener of factsListeners) listener(factsChildren)
    }
    const fiber = await ctx.plugin(plugin)
    let sequence = 0
    const create = async (id: string, preset = 'standard', parent?: Agent) => (await ctx.agents.create({
      sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'mock' },
      ...(parent === undefined ? {} : { parentAgent: parent }),
      setup: async owner => { await ctx.agentPresets.mount(owner, preset) },
    })).agent
    const execute = async (agent: Agent, name: string, args: unknown) => {
      const result = await ctx.tools.execute({ agent, callId: ToolCallId(`call-${++sequence}`), name, arguments: args, signal: new AbortController().signal })
      const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      if (result.isError) throw new Error(text)
      return JSON.parse(text)
    }
    return { ctx, fiber, create, execute, publishFacts, async dispose() { await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }) } }
  } catch (error) { await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }); throw error }
}
