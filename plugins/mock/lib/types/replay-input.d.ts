/**
 * Direct ZIP replay is intentionally unsupported in v1. A ZIP archive is
 * binary data, so treating it as UTF-8 JSONL would produce an ambiguous and
 * misleading parse error. Callers should extract its session.jsonl member and
 * replay that JSONL path instead.
 */
export declare class ReplayInputError extends Error {
    readonly code = "UNSUPPORTED_ARCHIVE";
    readonly path: string;
    constructor(path: string);
}
/** Read a replay source while rejecting ZIP input before UTF-8 conversion. */
export declare function readReplayInput(path: string, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=replay-input.d.ts.map