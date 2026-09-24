import { teamMembership } from "./membership.js";
import { installTeamTools } from "./tools.js";
export const name = 'mayfly-agent-team-tools';
export const inject = ['agents', 'agentTeams', 'agentPresets', 'tools', 'systemPrompt'];
export function apply(ctx) {
    const installed = new Map();
    const sync = (agent) => {
        if (teamMembership(ctx, agent) === undefined) {
            installed.get(agent)?.();
            installed.delete(agent);
        }
        else if (!installed.has(agent)) {
            installed.set(agent, installTeamTools(agent, ctx, { freshProvider: 'spawn', forkProvider: 'fork' }));
        }
    };
    for (const agent of ctx.agents.list())
        sync(agent);
    ctx.on('agent/created', ({ agent }) => { sync(agent); });
    ctx.on('agent-preset/selected', () => { for (const agent of ctx.agents.list())
        sync(agent); });
    ctx.on('agent/disposed', ({ agent }) => {
        installed.get(agent)?.();
        installed.delete(agent);
    });
    ctx.effect(() => () => { for (const dispose of installed.values())
        dispose(); installed.clear(); });
}
