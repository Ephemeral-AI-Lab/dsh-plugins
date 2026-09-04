export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

/** Resolve a lifecycle operation within a fixed bound, without leaking a timer. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  const boundedMs = Math.max(0, Math.floor(timeoutMs))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, boundedMs)
    promise.then(
      value => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

export async function terminateAndJoin(backend: {
  terminate(): Promise<void>
  waitForExit(): Promise<unknown>
  waitForQuiescence(): Promise<void>
}): Promise<void> {
  await withTimeout(backend.terminate(), 1_000, undefined).catch(() => undefined)
  await Promise.allSettled([
    withTimeout(backend.waitForExit(), 1_000, undefined),
    withTimeout(backend.waitForQuiescence(), 1_000, undefined),
  ])
}
