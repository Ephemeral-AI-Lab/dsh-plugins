/** Strict, JSON-only parsing for the public `/mock` command surface. */
export interface ParsedToolCall {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
}
export interface MockRunCommand {
    readonly kind: 'run';
    readonly calls: readonly ParsedToolCall[];
}
export interface MockReplayCommand {
    readonly kind: 'replay';
    readonly path: string;
    readonly overwriteWaitTimeMs?: number;
}
export type ParsedMockCommand = MockRunCommand | MockReplayCommand;
export declare class MockCommandParseError extends Error {
    readonly code = "INVALID_COMMAND";
    constructor(message: string);
}
/** The tool-name grammar shared by command and canonical-script validation. */
export declare function isMockToolName(value: string): boolean;
/**
 * Parse exactly one `tool_name(JSON_OBJECT)` expression.
 *
 * This scanner only locates the outer parentheses. JSON.parse remains the
 * sole parser for the argument data, so JavaScript expressions can never be
 * evaluated accidentally.
 */
export declare function parseToolCall(input: string): ParsedToolCall;
/** Parse `/mock run ...` or `/mock replay ...` in its entirety. */
export declare function parseMockCommand(input: string): ParsedMockCommand;
/** Parse the single-call or one-parallel-group `/mock run` grammar. */
export declare function parseRunCommand(input: string): MockRunCommand;
/** Parse `/mock replay <path> [--overwrite-wait-time-ms <N>]`. */
export declare function parseReplayCommand(input: string): MockReplayCommand;
//# sourceMappingURL=parser.d.ts.map