import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './types.js';
export declare const name = "codex-terminal";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: Config): void;
export { ExecSessionService } from './session/exec-session-service.js';
export { OutputLog } from './session/output-log.js';
export { SessionRegistry } from './session/session-registry.js';
export { createPtyFirstFactory } from './backend/pty-backend.js';
export { createPipeBackend } from './backend/pipe-backend.js';
export { createNodePtyBackend } from './backend/node-pty-backend.js';
export { PosixShellAdapter } from './shell/posix-shell.js';
export { WindowsPowerShellAdapter } from './shell/windows-powershell.js';
export type * from './types.js';
//# sourceMappingURL=index.d.ts.map