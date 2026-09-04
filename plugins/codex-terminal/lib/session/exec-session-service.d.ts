import type { BackendFactory, BackgroundJobs, ExecRequest, ExecResult, ResolvedConfig, SessionOwner, ShellAdapter, WriteRequest } from '../types.js';
import type { ExecutionPolicy } from '../policy/execution-policy.js';
export declare class UnknownSessionError extends Error {
    constructor(jobId: string);
}
export declare class SessionOwnershipError extends Error {
    constructor(jobId: string);
}
export declare class MaxSessionsError extends Error {
    constructor(limit: number);
}
export declare class ExecSessionService {
    private readonly config;
    private readonly shellAdapter;
    private readonly backendFactory;
    private readonly policy?;
    private readonly jobs?;
    private readonly registry;
    private readonly completed;
    private readonly ownerCleanup;
    private readonly closedOwners;
    private disposed;
    private readonly anonymousOwner;
    constructor(config: ResolvedConfig, shellAdapter: ShellAdapter, backendFactory: BackendFactory, policy?: ExecutionPolicy | undefined, jobs?: BackgroundJobs | undefined);
    ownerFor(owner: object | undefined): SessionOwner;
    exec(request: ExecRequest): Promise<ExecResult>;
    write(request: WriteRequest): Promise<ExecResult>;
    closeOwner(owner: SessionOwner): Promise<void>;
    dispose(): Promise<void>;
    get liveSessionCount(): number;
    private publish;
    private performWrite;
    private collect;
    private finishOperation;
    private requireOwned;
    private removeCompleted;
    private abortSession;
    private terminateRecord;
    private releaseRecord;
    private cleanupUnpublished;
    private notifyNaturalExit;
    private promote;
    private settlePromoted;
    private installOwnerCleanup;
}
export declare class StdinClosedError extends Error {
    constructor(jobId: string);
}
//# sourceMappingURL=exec-session-service.d.ts.map