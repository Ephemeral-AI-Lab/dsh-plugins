/** Trusted development policy. Host-policy is deliberately not implemented yet. */
export function createExecutionPolicy(mode) {
    if (mode === 'host-policy') {
        throw new Error('codex-terminal: executionMode "host-policy" is unsupported until an explicit DHS policy adapter is supplied');
    }
    return {
        mode,
        async authorize(_command, _cwd, signal) {
            if (signal.aborted)
                throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
        },
    };
}
//# sourceMappingURL=execution-policy.js.map