import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionSendArgs, SessionSendResult } from './types.js';
/** Sends messages to existing sessions and owns handles resumed for delivery. */
export declare class SessionSendService {
    private readonly ctx;
    private readonly ownedHandles;
    private readonly persistence;
    constructor(ctx: Context);
    send(args: SessionSendArgs, parent?: Agent, signal?: AbortSignal): Promise<SessionSendResult>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=send-service.d.ts.map