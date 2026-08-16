import type { BackendSpawnRequest, BackendFactory, PtyFallback, SessionBackend } from '../types.js'
import { createNodePtyBackend } from './node-pty-backend.js'
import { createPipeBackend } from './pipe-backend.js'

type BackendCreator = (request: BackendSpawnRequest) => Promise<SessionBackend>

/** PTY-first factory with an explicit, deployment-configured fallback. */
export function createPtyFirstFactory(
  fallback: PtyFallback,
  ptyCreator: BackendCreator = createNodePtyBackend,
  pipeCreator: BackendCreator = createPipeBackend,
): BackendFactory {
  return async (request: BackendSpawnRequest) => {
    try {
      return await ptyCreator(request)
    } catch (error: unknown) {
      if (fallback === 'error') {
        throw new Error(`PTY allocation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      return pipeCreator(request)
    }
  }
}
