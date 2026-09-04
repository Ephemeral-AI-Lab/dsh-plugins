import { delay } from '../session/lifecycle.js';
// Windows PowerShell 5.1 can drop input sent while the bundled ConPTY is
// attaching. Delay only input operations, so exec can still return a session
// promptly while the first write remains reliable.
export async function createNodePtyBackend(request) {
    const nodePty = await import('node-pty');
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined)
            env[key] = value;
    }
    const useConptyDll = process.platform === 'win32';
    const terminal = nodePty.spawn(request.executable, [...request.argv], {
        name: 'xterm-256color',
        cols: request.cols,
        rows: request.rows,
        cwd: request.cwd,
        env,
        useConptyDll,
    });
    return new NodePtyBackend(terminal, useConptyDll ? request.windowsPtyStartupGraceMs : 0);
}
class NodePtyBackend {
    terminal;
    transport = 'pty';
    pid;
    listeners = new Set();
    pendingData = [];
    exit;
    exited = false;
    termination;
    inputReadyAt;
    constructor(terminal, startupGraceMs) {
        this.terminal = terminal;
        this.inputReadyAt = Date.now() + startupGraceMs;
        this.pid = terminal.pid;
        terminal.onData(data => {
            const bytes = new TextEncoder().encode(data);
            if (this.listeners.size === 0) {
                this.pendingData.push(bytes);
                return;
            }
            for (const listener of [...this.listeners])
                listener('pty', bytes);
        });
        this.exit = new Promise(resolve => {
            terminal.onExit(({ exitCode, signal }) => {
                this.exited = true;
                resolve({
                    exitCode,
                    signal: signal === undefined || signal === 0 ? null : String(signal),
                });
            });
        });
    }
    onData(listener) {
        this.listeners.add(listener);
        for (const data of this.pendingData.splice(0))
            listener('pty', data);
        return () => this.listeners.delete(listener);
    }
    async write(data) {
        await this.waitForInputReady();
        this.terminal.write(new TextDecoder().decode(data));
    }
    async closeStdin() {
        await this.waitForInputReady();
        // PTYs do not expose a portable close-only stdin operation. Sending EOF is
        // the least surprising equivalent and does not terminate the process tree.
        this.terminal.write('\u0004');
    }
    async interrupt() {
        await this.waitForInputReady();
        this.terminal.write('\u0003');
    }
    async terminate() {
        if (this.exited)
            return;
        if (this.termination !== undefined)
            return this.termination;
        this.termination = this.terminateTree();
        return this.termination;
    }
    waitForExit() {
        return this.exit;
    }
    async waitForQuiescence() {
        await Promise.allSettled([this.exit, delay(25)]);
    }
    async terminateTree() {
        // Let node-pty inspect and release the live ConPTY before taskkill removes
        // the console it needs to enumerate. taskkill remains the tree-cleanup
        // backstop rather than the first teardown operation.
        try {
            this.terminal.kill();
        }
        catch { /* already exited */ }
        if (this.pid !== undefined && process.platform === 'win32') {
            await runTaskkill(this.pid);
        }
        await Promise.allSettled([this.exit, delay(150)]);
        if (this.pid !== undefined && process.platform !== 'win32') {
            try {
                process.kill(-this.pid, 'SIGKILL');
            }
            catch { /* already exited */ }
        }
    }
    async waitForInputReady() {
        const remaining = this.inputReadyAt - Date.now();
        if (remaining > 0)
            await delay(remaining);
    }
}
async function runTaskkill(pid) {
    const { spawn } = await import('node:child_process');
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
    });
    await new Promise(resolve => {
        killer.once('error', () => resolve());
        killer.once('close', () => resolve());
    });
}
//# sourceMappingURL=node-pty-backend.js.map