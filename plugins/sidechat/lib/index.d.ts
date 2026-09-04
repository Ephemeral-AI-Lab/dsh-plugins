import type { Context } from '@deepseek-ai/cordis';
export declare const name = "sidechat";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
export { SideChatRuntime, SIDECHAT_SYSTEM_PROMPT } from './service.js';
export { requestRoute, sideChatKind, stableMessages } from './context.js';
export type * from './types.js';
//# sourceMappingURL=index.d.ts.map