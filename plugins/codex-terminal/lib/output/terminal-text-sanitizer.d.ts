/**
 * Removes terminal control sequences from PTY text before it reaches the
 * model-facing output log. The state is streaming because node-pty may split
 * one ANSI/VT sequence across multiple data events.
 */
export declare class TerminalTextSanitizer {
    private pending;
    push(text: string): string;
    /** Flush text after UTF-8 decoding has finished. Incomplete controls are dropped. */
    finish(text?: string): string;
}
//# sourceMappingURL=terminal-text-sanitizer.d.ts.map