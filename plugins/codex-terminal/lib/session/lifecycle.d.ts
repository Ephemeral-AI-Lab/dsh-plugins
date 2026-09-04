export declare function delay(ms: number): Promise<void>;
/** Resolve a lifecycle operation within a fixed bound, without leaking a timer. */
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T>;
export declare function throwIfAborted(signal: AbortSignal): void;
export declare function terminateAndJoin(backend: {
    terminate(): Promise<void>;
    waitForExit(): Promise<unknown>;
    waitForQuiescence(): Promise<void>;
}): Promise<void>;
//# sourceMappingURL=lifecycle.d.ts.map