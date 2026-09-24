/** Exact-Agent admission for the optional Team preset. @module dsh-mayfly-agent-team/membership */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TeamMembership } from '@deepseek-ai/dsh-experimental-agent-team';
export declare const TEAM_PRESET = "team";
/** Runtime roots distinguish ordinary forks from unpublished-descriptor Workflow children. */
export declare function teamMembership(ctx: Context, agent: Agent): TeamMembership | undefined;
