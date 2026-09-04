export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}
/** Resolve a lifecycle operation within a fixed bound, without leaking a timer. */
export function withTimeout(promise, timeoutMs, fallback) {
    const boundedMs = Math.max(0, Math.floor(timeoutMs));
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            resolve(fallback);
        }, boundedMs);
        promise.then(value => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, error => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
    });
}
export function throwIfAborted(signal) {
    if (!signal.aborted)
        return;
    throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The operation was aborted', 'AbortError');
}
export async function terminateAndJoin(backend) {
    await withTimeout(backend.terminate(), 1_000, undefined).catch(() => undefined);
    await Promise.allSettled([
        withTimeout(backend.waitForExit(), 1_000, undefined),
        withTimeout(backend.waitForQuiescence(), 1_000, undefined),
    ]);
}
//# sourceMappingURL=lifecycle.js.map