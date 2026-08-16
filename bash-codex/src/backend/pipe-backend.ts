import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { BackendSpawnRequest, SessionBackend, OutputStream, ExitStatus } from '../types.js'
import { delay } from '../session/lifecycle.js'

export async function createPipeBackend(request: BackendSpawnRequest): Promise<SessionBackend> {
  const child = spawn(request.executable, [...request.argv], {
    cwd: request.cwd,
    shell: false,
    detached: true,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const backend = new PipeBackend(child)
  await backend.ready
  return backend
}

class PipeBackend implements SessionBackend {
  readonly transport = 'pipe' as const
  readonly pid: number | undefined
  readonly ready: Promise<void>
  private readonly listeners = new Set<(stream: OutputStream, data: Uint8Array) => void>()
  private readonly pendingData: Array<{ stream: OutputStream; data: Uint8Array }> = []
  private readonly exit: Promise<ExitStatus>
  private termination: Promise<void> | undefined
  private stdinClosed = false

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.pid = child.pid
    this.ready = new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn)
        reject(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })
    child.stdout.on('data', data => this.emit('stdout', data))
    child.stderr.on('data', data => this.emit('stderr', data))
    this.exit = new Promise<ExitStatus>((resolve, reject) => {
      child.once('error', error => reject(error))
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
  }

  onData(listener: (stream: OutputStream, data: Uint8Array) => void): () => void {
    this.listeners.add(listener)
    for (const item of this.pendingData.splice(0)) listener(item.stream, item.data)
    return () => this.listeners.delete(listener)
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.stdinClosed || this.child.stdin.destroyed) throw new Error('session stdin is closed')
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(Buffer.from(data), error => error === undefined ? resolve() : reject(error))
    })
  }

  async closeStdin(): Promise<void> {
    if (this.stdinClosed) return
    this.stdinClosed = true
    this.child.stdin.end()
  }

  async interrupt(): Promise<void> {
    if (this.pid === undefined) return
    if (process.platform === 'win32') {
      await runTaskkill(this.pid, false)
      return
    }
    try {
      process.kill(-this.pid, 'SIGINT')
    } catch {
      try { process.kill(this.pid, 'SIGINT') } catch { /* already exited */ }
    }
  }

  async terminate(): Promise<void> {
    if (this.termination !== undefined) return this.termination
    this.termination = this.terminateTree()
    return this.termination
  }

  waitForExit(): Promise<ExitStatus> {
    return this.exit
  }

  async waitForQuiescence(): Promise<void> {
    await Promise.allSettled([this.exit, delay(25)])
  }

  private async terminateTree(): Promise<void> {
    if (this.pid === undefined) return
    if (process.platform === 'win32') {
      await runTaskkill(this.pid, true)
      return
    }
    try {
      process.kill(-this.pid, 'SIGTERM')
    } catch {
      try { process.kill(this.pid, 'SIGTERM') } catch { return }
    }
    await Promise.race([this.exit.catch(() => undefined), delay(150)])
    if (!this.child.killed) {
      try { process.kill(-this.pid, 'SIGKILL') } catch { /* already exited */ }
    }
  }

  private emit(stream: OutputStream, data: Uint8Array): void {
    if (this.listeners.size === 0) {
      this.pendingData.push({ stream, data: new Uint8Array(data) })
      return
    }
    for (const listener of [...this.listeners]) listener(stream, data)
  }
}

async function runTaskkill(pid: number, force: boolean): Promise<void> {
  const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
    windowsHide: true,
    stdio: 'ignore',
  })
  await new Promise<void>(resolve => {
    killer.once('error', () => resolve())
    killer.once('close', () => resolve())
  })
}
