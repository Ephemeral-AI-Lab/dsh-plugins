/** Small streaming UTF-8 decoder used by output-facing tests and adapters. */
export declare class StreamingTextDecoder {
    private readonly decoder;
    push(bytes: Uint8Array): string;
    finish(): string;
}
//# sourceMappingURL=text-decoder.d.ts.map