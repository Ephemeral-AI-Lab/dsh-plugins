export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
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
  await backend.terminate()
  await Promise.allSettled([backend.waitForExit(), backend.waitForQuiescence()])
}
