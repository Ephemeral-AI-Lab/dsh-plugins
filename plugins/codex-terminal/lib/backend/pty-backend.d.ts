import type { BackendSpawnRequest, BackendFactory, PtyFallback, SessionBackend } from '../types.js';
type BackendCreator = (request: BackendSpawnRequest) => Promise<SessionBackend>;
/** PTY-first factory with an explicit, deployment-configured fallback. */
export declare function createPtyFirstFactory(fallback: PtyFallback, ptyCreator?: BackendCreator, pipeCreator?: BackendCreator): BackendFactory;
export {};
//# sourceMappingURL=pty-backend.d.ts.map