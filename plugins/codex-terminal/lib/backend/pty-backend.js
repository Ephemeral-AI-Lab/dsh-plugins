import { createNodePtyBackend } from './node-pty-backend.js';
import { createPipeBackend } from './pipe-backend.js';
/** PTY-first factory with an explicit, deployment-configured fallback. */
export function createPtyFirstFactory(fallback, ptyCreator = createNodePtyBackend, pipeCreator = createPipeBackend) {
    return async (request) => {
        try {
            return await ptyCreator(request);
        }
        catch (error) {
            if (fallback === 'error') {
                throw new Error(`PTY allocation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
            return pipeCreator(request);
        }
    };
}
//# sourceMappingURL=pty-backend.js.map