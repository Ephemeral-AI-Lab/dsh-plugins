import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type LoopRecord, type LoopView } from './types.js';
export declare const MAX_TIMER_DELAY_MS = 2147483647;
export declare class LoopInputError extends Error {
    constructor(message: string);
}
export declare class LoopLogError extends Error {
    constructor(message: string);
}
export type LoopFailurePhase = 'initial-flush' | 'send' | 'dispatch-append' | 'post-dispatch-flush' | 'runtime';
export declare class LoopRuntimeError extends Error {
    readonly phase: LoopFailurePhase;
    constructor(phase: LoopFailurePhase, cause: unknown);
}
export interface FoldedLoops {
    readonly active: readonly LoopRecord[];
    readonly seenIds: readonly string[];
}
export declare function createLoopRecord(prompt: string, timeInSeconds: number, now?: number, id?: string): LoopRecord;
export declare function renderLoopMessage(id: string, prompt: string): string;
export declare function foldLoopEvents(events: readonly SessionEvent[], seedLength?: number): FoldedLoops;
export declare function loopView(record: LoopRecord, now?: number): LoopView;
export declare function nextOccurrence(record: LoopRecord, now: number): number;
export interface LoopRuntimeOptions {
    readonly ctx: Context;
    readonly agent: Agent;
    readonly onError?: (error: LoopRuntimeError) => void;
}
/** One disposable timer projection for one exact agent. */
export declare class LoopRuntime {
    private readonly options;
    private timer;
    private requested;
    private running;
    private queue;
    private stopping;
    private disposal;
    private failure;
    private pendingTransactions;
    private pausedForTransaction;
    constructor(options: LoopRuntimeOptions);
    get lastError(): LoopRuntimeError | undefined;
    start(): void;
    requestDrive(): void;
    transact<T>(task: () => Promise<T>): Promise<T>;
    dispose(): Promise<void>;
    private enqueue;
    private driveOnce;
    private arm;
    private clearTimer;
    private isLive;
}
export declare function flushPersistence(ctx: Context, agent: Agent): Promise<void>;
export declare function applyLoopChange(state: readonly LoopRecord[], change: unknown): readonly LoopRecord[];
//# sourceMappingURL=loop.d.ts.map