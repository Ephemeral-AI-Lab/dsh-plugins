export const TEAM_PRESET = 'team';
/** Runtime roots distinguish ordinary forks from unpublished-descriptor Workflow children. */
export function teamMembership(ctx, agent) {
    if (ctx.agents.get(agent.id) !== agent || ctx.agentPresets.composedPreset(agent.ctx) !== TEAM_PRESET)
        return undefined;
    const member = ctx.agentTeams.tryMembership(agent);
    if (member === undefined || ctx.agentPresets.composedPreset(member.root.ctx) !== TEAM_PRESET)
        return undefined;
    if (!ctx.agents.roots().includes(member.root))
        return undefined;
    return member;
}
