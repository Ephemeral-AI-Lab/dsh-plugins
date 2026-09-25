/** Native Team tool schemas and direct service calls, adapted for preset-owned registration.
 * Derived from deepseek-ai/deepseek-harness dsh-v0.1.7-rc.1 (MIT); see NOTICE.
 * @module dsh-mayfly-agent-team/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export interface Config {
    readonly freshProvider: string;
    readonly forkProvider: string;
}
/** Register the complete Team tool set in one exact Agent scope. */
export declare function installTeamTools(agent: Agent, ctx: Context, config: Config): () => void;
