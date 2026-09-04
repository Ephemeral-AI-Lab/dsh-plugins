import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CreateSessionArgs, CreateSessionResult } from './types.js';
/**
 * Creates detached sessions from the host context and keeps their handles
 * owned by this plugin until the host disposes it.
 */
export declare class SessionCreationService {
    private readonly ctx;
    private readonly ownedHandles;
    constructor(ctx: Context);
    createSession(args: CreateSessionArgs, parent?: Agent, signal?: AbortSignal): Promise<CreateSessionResult>;
    dispose(): Promise<void>;
    private resolveSelection;
    private resolvePreset;
    private resolveLocation;
}
//# sourceMappingURL=creation-service.d.ts.map