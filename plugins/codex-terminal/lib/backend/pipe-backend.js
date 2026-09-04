import { spawn } from 'node:child_process';
import { delay, terminateAndJoin, withTimeout } from '../session/lifecycle.js';
// Keep the pre-publication queue bounded by the session output limit and make
// overflow visible to the session log instead of retaining an unbounded array.
const DEFAULT_PREPUBLICATION_QUEUE_BYTES = 1_048_576;
const PREPUBLICATION_TRUNCATION_MARKER = Buffer.from('<output truncated before session publication>\n', 'utf8');
const OUTPUT_DRAIN_TIMEOUT_MS = 1_000;
const TERMINATION_GRACE_MS = 150;
export async function createPipeBackend(request) {
    const child = spawn(request.executable, [...request.argv], {
        cwd: request.cwd,
        shell: false,
        // POSIX uses a detached process group so group signals can terminate the
        // whole shell tree. On Windows, detached children can close their pipe
        // handles before Node drains redirected PowerShell output.
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const backend = new PipeBackend(child, request.maxOutputBytes ?? DEFAULT_PREPUBLICATION_QUEUE_BYTES);
    try {
        await backend.ready;
        return backend;
    }
    catch (error) {
        await terminateAndJoin(backend).catch(() => undefined);
        throw error;
    }
}
class PipeBackend {
    child;
    transport = 'pipe';
    pid;
    ready;
    listeners = new Set();
    pendingData = [];
    prepublicationQueueBytes;
    pendingDataBytes = 0;
    pendingDataTruncated = false;
    exit;
    outputDrain;
    termination;
    stdinClosing;
    quiescence;
    stdinClosed = false;
    constructor(child, maxOutputBytes) {
        this.child = child;
        this.prepublicationQueueBytes = normalizeQueueLimit(maxOutputBytes);
        this.pid = child.pid;
        this.ready = new Promise((resolve, reject) => {
            const onSpawn = () => {
                child.off('error', onError);
                resolve();
            };
            const onError = (error) => {
                child.off('spawn', onSpawn);
                reject(error);
            };
            child.once('spawn', onSpawn);
            child.once('error', onError);
        });
        child.stdout.on('data', data => this.emit('stdout', data));
        child.stderr.on('data', data => this.emit('stderr', data));
        this.outputDrain = Promise.all([
            waitForReadableDrain(child.stdout),
            waitForReadableDrain(child.stderr),
        ]).then(() => undefined);
        this.exit = new Promise((resolve, reject) => {
            child.once('error', error => reject(error));
            child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
        });
    }
    onData(listener) {
        this.listeners.add(listener);
        const pending = this.pendingData.splice(0);
        this.pendingDataBytes = 0;
        for (const item of pending)
            listener(item.stream, item.data);
        return () => this.listeners.delete(listener);
    }
    async write(data) {
        if (this.stdinClosed || this.child.stdin.destroyed)
            throw new Error('session stdin is closed');
        await new Promise((resolve, reject) => {
            this.child.stdin.write(Buffer.from(data), error => error == null ? resolve() : reject(error));
        });
    }
    async closeStdin() {
        if (this.stdinClosing !== undefined)
            return this.stdinClosing;
        this.stdinClosed = true;
        if (this.child.stdin.destroyed || this.child.stdin.writableEnded)
            return;
        this.stdinClosing = withTimeout(new Promise((resolve, reject) => {
            this.child.stdin.end((error) => error == null ? resolve() : reject(error));
        }), OUTPUT_DRAIN_TIMEOUT_MS, undefined);
        await this.stdinClosing;
    }
    async interrupt() {
        if (this.pid === undefined)
            return;
        if (process.platform === 'win32') {
            await runTaskkill(this.pid, false);
            return;
        }
        try {
            process.kill(-this.pid, 'SIGINT');
        }
        catch {
            try {
                process.kill(this.pid, 'SIGINT');
            }
            catch { /* already exited */ }
        }
    }
    async terminate() {
        if (this.termination !== undefined)
            return this.termination;
        this.termination = this.terminateTree();
        return this.termination;
    }
    waitForExit() {
        return this.exit;
    }
    async waitForQuiescence() {
        if (this.quiescence !== undefined)
            return this.quiescence;
        this.quiescence = this.waitForQuiescenceOnce();
        return this.quiescence;
    }
    async waitForQuiescenceOnce() {
        await this.exit.catch(() => undefined);
        await withTimeout(this.outputDrain, OUTPUT_DRAIN_TIMEOUT_MS, undefined);
        // Give already-readable data a final turn through Node's event loop after
        // both streams report EOF. The close event normally implies this drain;
        // the bounded timeout above is only a failsafe for a broken child stream.
        await delay(25);
    }
    async terminateTree() {
        if (this.pid === undefined)
            return;
        if (process.platform === 'win32') {
            await runTaskkill(this.pid, true);
            return;
        }
        try {
            process.kill(-this.pid, 'SIGTERM');
        }
        catch {
            try {
                process.kill(this.pid, 'SIGTERM');
            }
            catch {
                return;
            }
        }
        await Promise.race([this.exit.catch(() => undefined), delay(TERMINATION_GRACE_MS)]);
        if (!this.child.killed) {
            try {
                process.kill(-this.pid, 'SIGKILL');
            }
            catch { /* already exited */ }
        }
    }
    emit(stream, data) {
        if (data.byteLength === 0)
            return;
        if (this.listeners.size === 0) {
            this.queuePending(stream, data);
            return;
        }
        for (const listener of [...this.listeners])
            listener(stream, data);
    }
    queuePending(stream, data) {
        if (this.pendingDataTruncated)
            return;
        const remaining = this.prepublicationQueueBytes - this.pendingDataBytes;
        if (data.byteLength <= remaining) {
            this.pendingData.push({ stream, data: new Uint8Array(data) });
            this.pendingDataBytes += data.byteLength;
            return;
        }
        const payloadLimit = Math.max(0, this.prepublicationQueueBytes - PREPUBLICATION_TRUNCATION_MARKER.byteLength);
        const keep = Math.max(0, payloadLimit - this.pendingDataBytes);
        if (keep > 0) {
            this.pendingData.push({ stream, data: new Uint8Array(data.subarray(0, keep)) });
            this.pendingDataBytes += keep;
        }
        if (PREPUBLICATION_TRUNCATION_MARKER.byteLength <= this.prepublicationQueueBytes) {
            this.pendingData.push({
                stream,
                data: new Uint8Array(PREPUBLICATION_TRUNCATION_MARKER),
            });
            this.pendingDataBytes += PREPUBLICATION_TRUNCATION_MARKER.byteLength;
        }
        this.pendingDataTruncated = true;
    }
}
function normalizeQueueLimit(value) {
    if (!Number.isFinite(value) || value <= 0)
        return DEFAULT_PREPUBLICATION_QUEUE_BYTES;
    return Math.max(PREPUBLICATION_TRUNCATION_MARKER.byteLength, Math.floor(value));
}
function waitForReadableDrain(stream) {
    if ('readableEnded' in stream && stream.readableEnded === true)
        return Promise.resolve();
    if ('destroyed' in stream && stream.destroyed === true)
        return Promise.resolve();
    return new Promise(resolve => {
        const finish = () => {
            stream.off('end', finish);
            stream.off('close', finish);
            stream.off('error', finish);
            resolve();
        };
        stream.once('end', finish);
        stream.once('close', finish);
        stream.once('error', finish);
    });
}
async function runTaskkill(pid, force) {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
        windowsHide: true,
        stdio: 'ignore',
    });
    await withTimeout(new Promise(resolve => {
        killer.once('error', () => resolve());
        killer.once('close', () => resolve());
    }), OUTPUT_DRAIN_TIMEOUT_MS, undefined);
}
//# sourceMappingURL=pipe-backend.js.map