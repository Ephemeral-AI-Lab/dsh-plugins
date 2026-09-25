/**
 * Herdr orchestration tools for the model.
 *
 * Four `herdr_agent_*` tools wrap the pane/agent CLI surface so a dsh agent
 * running inside a Herdr pane can launch sibling sessions, prompt them, wait
 * on their reported state, and read their output as single structured calls
 * instead of composing shell pipelines. Every call shells out to the Herdr
 * binary named by `HERDR_BIN_PATH` (or `herdr` on PATH) and normalizes its
 * JSON envelope / exit-1 error contract through `cli.ts`.
 *
 * @module dsh-herdr-plus/tools
 */
import type { ToolRuntime } from '@deepseek-ai/dsh-tools';
import type { HerdrEnv } from './transport.js';
/** Options for {@link registerHerdrTools}. */
export interface HerdrToolOptions {
    /**
     * Command line `herdr_agent_spawn` runs in the sibling pane; the task is
     * appended as one shell-quoted argv word.
     */
    launchCommand: string;
    /** Poll deadline for a fresh pane's shell prompt (test seam). */
    shellReadyTimeoutMs?: number;
    /** Poll deadline for a spawned sibling's agent registration (test seam). */
    agentReadyTimeoutMs?: number;
}
/**
 * Register the four `herdr_agent_*` tools on the tools service.
 * @param tools - the resolved `ctx.get('tools')` runtime.
 * @param env - pane environment carrying `HERDR_*` variables.
 * @param options - launch command and readiness deadlines.
 * @returns a disposer that unregisters every tool.
 */
export declare function registerHerdrTools(tools: ToolRuntime, env: HerdrEnv, options: HerdrToolOptions): () => void;
//# sourceMappingURL=tools.d.ts.map