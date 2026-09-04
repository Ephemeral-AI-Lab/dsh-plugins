export const DEFAULT_TOKEN_BYTES = 4;
export function normalizeOutputLimit(limit, fallback, maximum) {
    const tokens = Number.isFinite(limit.maxOutputTokens) && limit.maxOutputTokens > 0
        ? Math.floor(limit.maxOutputTokens)
        : fallback;
    return { maxOutputTokens: Math.min(Math.max(1, tokens), maximum) };
}
export function markTruncated(read, truncated) {
    return truncated === read.truncated ? read : { ...read, truncated: true };
}
//# sourceMappingURL=output-limiter.js.map