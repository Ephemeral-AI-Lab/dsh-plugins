import type { OutputLimit, OutputRead } from '../types.js';
export declare const DEFAULT_TOKEN_BYTES = 4;
export declare function normalizeOutputLimit(limit: OutputLimit, fallback: number, maximum: number): OutputLimit;
export declare function markTruncated(read: OutputRead, truncated: boolean): OutputRead;
//# sourceMappingURL=output-limiter.d.ts.map