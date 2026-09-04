/** Small streaming UTF-8 decoder used by output-facing tests and adapters. */
export class StreamingTextDecoder {
    decoder = new TextDecoder('utf-8');
    push(bytes) {
        return this.decoder.decode(bytes, { stream: true });
    }
    finish() {
        return this.decoder.decode();
    }
}
//# sourceMappingURL=text-decoder.js.map