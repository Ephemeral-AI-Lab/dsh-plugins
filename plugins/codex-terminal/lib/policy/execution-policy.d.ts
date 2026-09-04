import type { ExecutionMode } from '../types.js';
/** Deployment-level policy seam; it is intentionally absent from tool schemas. */
export interface ExecutionPolicy {
    readonly mode: ExecutionMode;
    authorize(command: string, cwd: string, signal: AbortSignal): Promise<void>;
}
/** Trusted development policy. Host-policy is deliberately not implemented yet. */
export declare function createExecutionPolicy(mode: ExecutionMode): ExecutionPolicy;
//# sourceMappingURL=execution-policy.d.ts.map