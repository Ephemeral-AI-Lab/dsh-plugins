export declare const DEFAULT_WAIT_TIME_MS = 100;
export interface MockToolStep {
    readonly tool: string;
    readonly args: Record<string, unknown>;
}
export interface MockWaitStep {
    readonly wait: number;
}
/** Backwards-compatible name retained for consumers of the initial scaffold. */
export type MockDelayStep = MockWaitStep;
export interface MockParallelStep {
    readonly parallel: readonly MockToolStep[];
}
export type MockScriptStep = MockToolStep | MockWaitStep | MockParallelStep;
export interface MockScript {
    readonly type: 'dsh-mock-script';
    readonly version: 1;
    readonly steps: readonly MockScriptStep[];
}
export interface CompiledMockStep {
    readonly sourceIndex: number;
    readonly executableIndex: number;
    readonly step: MockToolStep | MockParallelStep;
    readonly waitBefore: number;
    readonly explicitWaitBefore: boolean;
}
export interface CompiledMockScript {
    readonly script: MockScript;
    readonly steps: readonly CompiledMockStep[];
    readonly executableStepCount: number;
}
export type MockScriptErrorCode = 'INVALID_SCRIPT' | 'CONVERSION_MISMATCH';
export declare class MockScriptError extends Error {
    readonly code: MockScriptErrorCode;
    readonly line: number | undefined;
    readonly path: string | undefined;
    constructor(code: MockScriptErrorCode, message: string, details?: {
        line?: number;
        path?: string;
    });
}
export declare class DshJsonlConversionError extends MockScriptError {
    readonly line: number;
    constructor(line: number, message: string, code?: MockScriptErrorCode, path?: string);
}
/** Parse and validate canonical JSON with the same validator used by converters. */
export declare function parseCanonicalScript(input: string, path?: string): MockScript;
/** Validate every canonical field and return a detached, JSON-only script. */
export declare function validateMockScript(value: unknown, path?: string): MockScript;
/** Compile implicit and explicit inter-step waits without changing membership. */
export declare function compileMockScript(value: MockScript, overwriteWaitTimeMs?: number): CompiledMockScript;
/** Stable canonical serialization for diagnostics, tests, and future export. */
export declare function serializeMockScript(value: MockScript): string;
/**
 * Convert a native DSH JSONL log into canonical mock-script JSON. Results and
 * approvals are evidence only; no historical result is put into the script.
 */
export declare function convertDshJsonl(input: string, path?: string): MockScript;
//# sourceMappingURL=converter.d.ts.map