import { TextDecoder } from 'node:util';
import { TerminalTextSanitizer } from '../output/terminal-text-sanitizer.js';
const TRUNCATION_MARKER = '<output truncated>\n';
/**
 * Cursor-addressable, bounded output owned by one execution session.
 *
 * The log keeps a head and tail once its byte ceiling is crossed. Cursors are
 * absolute source-byte positions, so an older cursor that falls into the
 * omitted middle returns an explicit marker and the retained tail.
 */
export class OutputLog {
    decoders = {
        pty: new TextDecoder('utf-8'),
        stdout: new TextDecoder('utf-8'),
        stderr: new TextDecoder('utf-8'),
    };
    sanitizers = {
        pty: new TerminalTextSanitizer(),
        stdout: new TerminalTextSanitizer(),
        stderr: new TerminalTextSanitizer(),
    };
    full = Buffer.alloc(0);
    head = Buffer.alloc(0);
    tail = Buffer.alloc(0);
    totalBytes = 0;
    truncatedBuffer = false;
    exited = false;
    listeners = new Set();
    maxBytes;
    constructor(maxBytes) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
            throw new Error('OutputLog maxBytes must be a positive safe integer');
        }
        this.maxBytes = maxBytes;
    }
    append(_stream, bytes) {
        if (bytes.byteLength === 0 || this.exited)
            return;
        this.appendText(this.sanitizers[_stream].push(this.decoders[_stream].decode(bytes, { stream: true })));
    }
    /** Flush incomplete UTF-8 sequences after the root process has closed. */
    finish() {
        if (this.exited)
            return;
        for (const stream of ['pty', 'stdout', 'stderr']) {
            this.appendText(this.sanitizers[stream].finish(this.decoders[stream].decode()));
        }
        this.exited = true;
        this.notify();
    }
    read(cursor, limit) {
        const safeCursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
        const maxOutputBytes = Math.max(1, Math.floor(limit.maxOutputTokens * 4));
        if (!this.truncatedBuffer) {
            const from = Math.min(safeCursor, this.full.byteLength);
            const available = this.full.subarray(from);
            const capped = available.byteLength > maxOutputBytes;
            const bytes = capped ? available.subarray(0, maxOutputBytes) : available;
            return {
                text: this.decode(bytes),
                nextCursor: from + bytes.byteLength,
                truncated: capped,
                hasMore: from + bytes.byteLength < this.full.byteLength,
            };
        }
        const headEnd = this.head.byteLength;
        const tailStart = Math.max(headEnd, this.totalBytes - this.tail.byteLength);
        if (safeCursor < headEnd) {
            const available = this.head.subarray(safeCursor);
            const capped = available.byteLength > maxOutputBytes;
            const bytes = capped ? available.subarray(0, maxOutputBytes) : available;
            return {
                text: this.decode(bytes),
                nextCursor: safeCursor + bytes.byteLength,
                truncated: true,
                hasMore: safeCursor + bytes.byteLength < this.totalBytes,
            };
        }
        if (safeCursor < tailStart) {
            const tailBytes = Buffer.concat([Buffer.from(TRUNCATION_MARKER), this.tail]);
            const capped = tailBytes.byteLength > maxOutputBytes;
            const bytes = capped ? tailBytes.subarray(0, maxOutputBytes) : tailBytes;
            const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
            const nextCursor = capped
                ? tailStart + Math.max(0, bytes.byteLength - markerBytes)
                : this.totalBytes;
            return {
                text: this.decode(bytes),
                nextCursor,
                truncated: true,
                hasMore: nextCursor < this.totalBytes,
            };
        }
        const tailOffset = Math.max(0, safeCursor - tailStart);
        const available = this.tail.subarray(tailOffset);
        const capped = available.byteLength > maxOutputBytes;
        const bytes = capped ? available.subarray(0, maxOutputBytes) : available;
        return {
            text: this.decode(bytes),
            nextCursor: tailStart + tailOffset + bytes.byteLength,
            truncated: true,
            hasMore: tailStart + tailOffset + bytes.byteLength < this.totalBytes,
        };
    }
    async waitForChange(cursor, signal) {
        if (this.totalBytes > cursor || this.exited)
            return;
        if (signal.aborted)
            throw abortReason(signal);
        await new Promise((resolve, reject) => {
            const onChange = () => {
                cleanup();
                resolve();
            };
            const onAbort = () => {
                cleanup();
                reject(abortReason(signal));
            };
            const cleanup = () => {
                this.listeners.delete(onChange);
                signal.removeEventListener('abort', onAbort);
            };
            this.listeners.add(onChange);
            signal.addEventListener('abort', onAbort, { once: true });
            if (this.totalBytes > cursor || this.exited)
                onChange();
        });
    }
    get size() {
        return this.totalBytes;
    }
    get isExited() {
        return this.exited;
    }
    get isTruncated() {
        return this.truncatedBuffer;
    }
    appendText(text) {
        if (text.length === 0)
            return;
        const bytes = Buffer.from(text, 'utf8');
        this.totalBytes += bytes.byteLength;
        if (!this.truncatedBuffer && this.full.byteLength + bytes.byteLength <= this.maxBytes) {
            this.full = Buffer.concat([this.full, bytes]);
            this.notify();
            return;
        }
        if (!this.truncatedBuffer) {
            const headBytes = Math.max(1, Math.floor(this.maxBytes / 2));
            const tailBytes = Math.max(1, this.maxBytes - headBytes);
            const combined = Buffer.concat([this.full, bytes]);
            this.head = combined.subarray(0, Math.min(headBytes, combined.byteLength));
            this.tail = combined.subarray(Math.max(0, combined.byteLength - tailBytes));
            this.full = Buffer.alloc(0);
            this.truncatedBuffer = true;
            this.notify();
            return;
        }
        const tailBytes = Math.max(1, this.maxBytes - this.head.byteLength);
        const combinedTail = Buffer.concat([this.tail, bytes]);
        this.tail = combinedTail.subarray(Math.max(0, combinedTail.byteLength - tailBytes));
        this.notify();
    }
    notify() {
        for (const listener of [...this.listeners])
            listener();
    }
    decode(bytes) {
        return new TextDecoder('utf-8').decode(bytes);
    }
}
function abortReason(signal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError');
}
//# sourceMappingURL=output-log.js.map