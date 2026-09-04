import type { Context } from '@deepseek-ai/cordis';
import { type MockUiState } from './mock-adapter.js';
export declare const name = "mock";
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Events {
        /** Ephemeral mock status for the host's compact status-row bridge. */
        'mock/status'(state: MockUiState): void;
    }
}
/**
 * Install the external mock provider and the per-turn command/request hooks.
 * The hooks are public AgentLoop extension points; the loop and ToolRuntime
 * remain the only code that executes, validates, authorizes, or records tools.
 */
export declare function apply(ctx: Context): void;
export { MockAdapter } from './mock-adapter.js';
export { executableStepCount, formatMockStatus } from './mock-adapter.js';
export type { MockAdapterEvent, MockPlanOptions, MockRunMode, MockRunPhase, MockUiState } from './mock-adapter.js';
export { MockScriptError, DshJsonlConversionError, compileMockScript, convertDshJsonl, parseCanonicalScript, serializeMockScript, validateMockScript, } from './converter.js';
export type { CompiledMockScript, CompiledMockStep, MockDelayStep, MockParallelStep, MockScript, MockScriptErrorCode, MockScriptStep, MockToolStep, MockWaitStep, } from './converter.js';
export { MockCommandParseError, isMockToolName, parseMockCommand, parseReplayCommand, parseRunCommand, parseToolCall, } from './parser.js';
export type { MockReplayCommand, MockRunCommand, ParsedMockCommand, ParsedToolCall } from './parser.js';
//# sourceMappingURL=index.d.ts.map