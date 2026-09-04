import type { OutputLimit, OutputRead, OutputStream } from '../types.js';
/**
 * Cursor-addressable, bounded output owned by one execution session.
 *
 * The log keeps a head and tail once its byte ceiling is crossed. Cursors are
 * absolute source-byte positions, so an older cursor that falls into the
 * omitted middle returns an explicit marker and the retained tail.
 */
export declare class OutputLog {
    private readonly decoders;
    private readonly sanitizers;
    private full;
    private head;
    private tail;
    private totalBytes;
    private truncatedBuffer;
    private exited;
    private readonly listeners;
    private readonly maxBytes;
    constructor(maxBytes: number);
    append(_stream: OutputStream, bytes: Uint8Array): void;
    /** Flush incomplete UTF-8 sequences after the root process has closed. */
    finish(): void;
    read(cursor: number, limit: OutputLimit): OutputRead;
    waitForChange(cursor: number, signal: AbortSignal): Promise<void>;
    get size(): number;
    get isExited(): boolean;
    get isTruncated(): boolean;
    private appendText;
    private notify;
    private decode;
}
//# sourceMappingURL=output-log.d.ts.map