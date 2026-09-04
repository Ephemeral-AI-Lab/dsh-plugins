import { SideChatRuntime } from './service.js';
export const name = 'sidechat';
export const inject = [
    'llm',
    'sessions',
    'sessionPersistence',
    'agents',
    'agentDefaultModel',
    'connection',
];
export function apply(ctx) {
    const runtime = new SideChatRuntime(ctx);
    ctx.connection.rpc.handle('/sidechat', async (endpoint, payload, signal) => ({
        ok: true,
        value: await runtime.handle(endpoint, payload, signal),
    }), { authority: 'loopback' });
    ctx.effect(() => () => { runtime.dispose(); }, 'sidechat.runtime()');
}
export { SideChatRuntime, SIDECHAT_SYSTEM_PROMPT } from './service.js';
export { requestRoute, sideChatKind, stableMessages } from './context.js';
//# sourceMappingURL=index.js.map