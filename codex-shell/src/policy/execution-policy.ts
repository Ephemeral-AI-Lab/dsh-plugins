import type { ExecutionMode } from '../types.js'

/** Deployment-level policy seam; it is intentionally absent from tool schemas. */
export interface ExecutionPolicy {
  readonly mode: ExecutionMode
  authorize(command: string, cwd: string, signal: AbortSignal): Promise<void>
}

/** Trusted development policy. Host-policy is deliberately not implemented yet. */
export function createExecutionPolicy(mode: ExecutionMode): ExecutionPolicy {
  if (mode === 'host-policy') {
    throw new Error('codex-shell: executionMode "host-policy" is unsupported until an explicit DHS policy adapter is supplied')
  }
  return {
    mode,
    async authorize(_command, _cwd, signal): Promise<void> {
      if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    },
  }
}
