import { PosixShellAdapter } from './posix-shell.js';
import { WindowsPowerShellAdapter } from './windows-powershell.js';
export function createShellAdapter(config) {
    return process.platform === 'win32'
        ? new WindowsPowerShellAdapter(config.windowsShell)
        : new PosixShellAdapter(config.posixShell);
}
//# sourceMappingURL=index.js.map