import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-sessions";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
export { SessionCreationService } from './creation-service.js';
export { SessionSendService } from './send-service.js';
export { LIST_STATUS_DEFAULT_RECENT_N, SessionsService, validateRecentN } from './service.js';
export { registerSessionTools, registerSessionTools as registerSessionsTool } from './tools/index.js';
export * from './types.js';
//# sourceMappingURL=index.d.ts.map