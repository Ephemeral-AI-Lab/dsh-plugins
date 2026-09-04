import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import { type MockScript } from './converter.js';
import type { MockRunMode, MockUiState } from './types.js';
export type { MockRunMode, MockRunPhase, MockUiState } from './types.js';
export interface MockPlanOptions {
    readonly sessionId: string;
    readonly runId?: string;
    readonly mode: MockRunMode;
    readonly script: MockScript;
    readonly overwriteWaitTimeMs?: number;
    readonly sourcePath?: string;
}
/** UI bridge helper: waits and implicit gaps never enter the denominator. */
export declare function executableStepCount(script: MockScript): number;
/** Compact generic label for the transient status row described by ui-ux.md. */
export declare function formatMockStatus(state: MockUiState): string;
export interface MockToolResultInfo {
    readonly isError: boolean;
    readonly code?: string;
}
export type MockAdapterEvent = {
    readonly kind: 'state';
    readonly state: MockUiState;
} | {
    readonly kind: 'disposed';
    readonly sessionId: string;
    readonly runId: string;
};
type BackgroundStream = (options: GenerateOptions) => AsyncIterable<StreamChunk> | undefined;
/**
 * Deterministic model output for the real AgentLoop.
 *
 * This class only emits `StreamChunk`s. Tool lookup, argument validation,
 * policy, approval, execution, result rendering, and durable events remain in
 * the host AgentLoop/ToolRuntime pipeline.
 */
export declare class MockAdapter extends LlmAdapter {
    private readonly plans;
    private readonly retiredCallIds;
    private readonly signalPlans;
    private readonly activeSignals;
    private readonly onEvent;
    private readonly backgroundStream;
    private disposed;
    constructor(onEvent?: (event: MockAdapterEvent) => void, backgroundStream?: BackgroundStream);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    get pendingSessionCount(): number;
    get pendingWaitCount(): number;
    /** Expose a detached snapshot for tests and host UI bridges. */
    getPlanState(sessionId: string): MockUiState | undefined;
    /** Start one validated, session-scoped plan. */
    startPlan(options: MockPlanOptions): MockUiState;
    /** Record the real ToolRuntime result associated with one emitted call. */
    noteToolResult(sessionId: string, callId: string, result: MockToolResultInfo, toolCallId?: string): void;
    private findPlanWithPendingCall;
    /** Clear one session; stale results can never advance another plan. */
    clearSession(sessionId: string, expectedRunId?: string): void;
    /** Release all adapter-owned plans, waits, and abort listeners. */
    dispose(): void;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private createDirectPlan;
    private emitExecutableStep;
    private delay;
    private waitForReportedResults;
    private finishSuccess;
    private finishWithError;
    private finishCancelled;
    private markProtocolError;
    private isCurrentPlan;
    private removePlan;
    private publish;
}
//# sourceMappingURL=mock-adapter.d.ts.map