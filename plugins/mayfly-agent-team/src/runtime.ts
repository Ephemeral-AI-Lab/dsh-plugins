/** Opt-in registrations over the native Team service. @module dsh-mayfly-agent-team/runtime */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { teamMembership } from './membership.ts'
import { installTeamTools } from './tools.ts'

export const name = 'mayfly-agent-team-tools'
export const inject = ['agents', 'agentTeams', 'agentPresets', 'tools', 'systemPrompt']

export function apply(ctx: Context): void {
  const installed = new Map<Agent, () => void>()
  const sync = (agent: Agent) => {
    if (teamMembership(ctx, agent) === undefined) {
      installed.get(agent)?.()
      installed.delete(agent)
    } else if (!installed.has(agent)) {
      installed.set(agent, installTeamTools(agent, ctx, { freshProvider: 'spawn', forkProvider: 'fork' }))
    }
  }
  for (const agent of ctx.agents.list()) sync(agent)
  ctx.on('agent/created', ({ agent }) => { sync(agent) })
  ctx.on('agent-preset/selected', () => { for (const agent of ctx.agents.list()) sync(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear() })
}
