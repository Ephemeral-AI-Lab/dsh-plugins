import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { LoopRuntime } from './loop.js';
import { registerLoopCommand } from './commands.js';
import { registerLoopTools } from './tools.js';
import { loopProjectionDefinition } from './projection.js';
export const name = 'loop';
export const inject = ['tools', 'commands', 'agents', 'sessions', 'sessionPersistence', 'sessionProjections'];
// Resolve from the running DSH entry point so linked plugins mutate the host's
// event catalog rather than a duplicate dependency under the plugin checkout.
const sessionModulePath = createRequire(
/* c8 ignore next */
process.argv[1] === undefined ? import.meta.url : pathToFileURL(realpathSync(process.argv[1]))).resolve('@deepseek-ai/dsh-session');
const { KNOWN_SESSION_EVENT_TYPES } = await import(pathToFileURL(sessionModulePath).href);
KNOWN_SESSION_EVENT_TYPES.add('loop/change');
export function apply(ctx) {
    ctx.sessionProjections.register(loopProjectionDefinition);
    registerLoopCommand(ctx, ctx);
    const runtimes = new Map();
    let stopping = false;
    ctx.effect(() => {
        const stopCreated = ctx.on('agent/created', ({ agent }) => {
            const attachedAgent = agent;
            if (stopping || runtimes.has(attachedAgent) || !ctx.agents.roots().includes(attachedAgent))
                return;
            const runtime = new LoopRuntime({
                ctx,
                agent: attachedAgent,
                onError: error => ctx.logger.warn(`loop runtime failed at ${error.phase} for session "${attachedAgent.session.id}": ${error.message}`),
            });
            const cleanup = attachedAgent.ctx.effect(() => {
                const disposeTools = registerLoopTools(ctx, attachedAgent.ctx, attachedAgent, runtime);
                runtime.start();
                return async () => {
                    disposeTools();
                    try {
                        await runtime.dispose();
                    }
                    finally {
                        if (runtimes.get(attachedAgent) === cleanup)
                            runtimes.delete(attachedAgent);
                    }
                };
            }, 'loop.runtime()');
            runtimes.set(attachedAgent, cleanup);
        });
        return async () => {
            stopping = true;
            stopCreated();
            const cleanups = [...runtimes.values()];
            runtimes.clear();
            await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())));
        };
    }, 'loop.lifecycle()');
}
export { LoopRuntime } from './loop.js';
export { registerLoopCommand } from './commands.js';
export { registerLoopTools } from './tools.js';
export * from './types.js';
//# sourceMappingURL=index.js.map