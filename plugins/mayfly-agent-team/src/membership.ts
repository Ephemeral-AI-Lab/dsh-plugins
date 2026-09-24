/** Exact-Agent admission for the optional Team preset. @module dsh-mayfly-agent-team/membership */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamMembership } from '@deepseek-ai/dsh-experimental-agent-team'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

export const TEAM_PRESET = 'team'

/** Runtime roots distinguish ordinary forks from unpublished-descriptor Workflow children. */
export function teamMembership(ctx: Context, agent: Agent): TeamMembership | undefined {
  if (ctx.agents.get(agent.id) !== agent || ctx.agentPresets.composedPreset(agent.ctx) !== TEAM_PRESET) return undefined
  const member = ctx.agentTeams.tryMembership(agent)
  if (member === undefined || ctx.agentPresets.composedPreset(member.root.ctx) !== TEAM_PRESET) return undefined
  if (!ctx.agents.roots().includes(member.root)) return undefined
  return member
}
