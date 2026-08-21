import { afterEach, describe, expect, it } from 'vitest'
import type {
  BackendFactory,
  ExitStatus,
  ResolvedConfig,
  SessionBackend,
  SessionOwner,
  ShellAdapter,
} from '../../src/types.js'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import { ExecSessionService, MaxSessionsError } from '../../src/session/exec-session-service.js'
import { delay } from '../../src/session/lifecycle.js'

const shell: ShellAdapter = {
  async resolve() {
    return {
      executable: 'fixture-shell',
      oneShotArgs: command => [command],
      interactiveArgs: () => [],
    }
  },
  oneShotArgs: command => [command],
  interactiveArgs: () => [],
}

const owner: SessionOwner = { ownerId: 'memory-retention-safety-owner' }
const services: ExecSessionService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()))
})

describe('exec session memory and retention safety', () => {
  it('fills maxSessions without evicting existing live sessions', async () => {
    const backends: ControlledBackend[] = []
    const service = makeService({ maxSessions: 3 }, async () => {
      const backend = new ControlledBackend()
      backends.push(backend)
      return backend
    })

    const started = await Promise.all([
      service.exec(request('first')),
      service.exec(request('second')),
      service.exec(request('third')),
    ])

    expect(started.map(result => result.job_id)).toEqual(['codex-terminal-1', 'codex-terminal-2', 'codex-terminal-3'])
    expect(service.liveSessionCount).toBe(3)
    await expect(service.exec(request('fourth'))).rejects.toBeInstanceOf(MaxSessionsError)
    expect(service.liveSessionCount).toBe(3)
    expect(backends).toHaveLength(3)
  })

  it('keeps completed-but-unpolled sessions in the capacity count', async () => {
    const backends: ControlledBackend[] = []
    const service = makeService({ maxSessions: 2 }, async () => {
      const backend = new ControlledBackend()
      backends.push(backend)
      return backend
    })

    await service.exec(request('first'))
    await service.exec(request('second'))
    backends[0]!.emit('stdout', 'first-final')
    backends[0]!.finish({ exitCode: 0, signal: null })
    backends[1]!.emit('stdout', 'second-final')
    backends[1]!.finish({ exitCode: 0, signal: null })
    await delay(0)

    expect(service.liveSessionCount).toBe(2)
    await expect(service.exec(request('third'))).rejects.toBeInstanceOf(MaxSessionsError)
    expect(service.liveSessionCount).toBe(2)

    const first = await service.write({ ...writeRequest('codex-terminal-1'), chars: '' })
    expect(first.output).toContain('first-final')
    expect(first.exit_code).toBe(0)
    expect(service.liveSessionCount).toBe(1)

    const second = await service.write({ ...writeRequest('codex-terminal-2'), chars: '' })
    expect(second.output).toContain('second-final')
    expect(second.exit_code).toBe(0)
    expect(service.liveSessionCount).toBe(0)
  })

  it('releases exactly one completed session per successful terminal poll', async () => {
    const backends: ControlledBackend[] = []
    const service = makeService({ maxSessions: 4 }, async () => {
      const backend = new ControlledBackend()
      backends.push(backend)
      return backend
    })

    await service.exec(request('one'))
    await service.exec(request('two'))
    backends[0]!.emit('stdout', 'one')
    backends[0]!.finish({ exitCode: 7, signal: null })
    backends[1]!.emit('stdout', 'two')
    backends[1]!.finish({ exitCode: 8, signal: null })
    await delay(0)

    const first = await service.write({ ...writeRequest('codex-terminal-1'), chars: '' })
    expect(first.exit_code).toBe(7)
    expect(service.liveSessionCount).toBe(1)
    expect(backends[0]!.listenerCount).toBe(0)
    expect(backends[1]!.listenerCount).toBe(1)

    const second = await service.write({ ...writeRequest('codex-terminal-2'), chars: '' })
    expect(second.exit_code).toBe(8)
    expect(service.liveSessionCount).toBe(0)
    expect(backends[1]!.listenerCount).toBe(0)
  })

  it('reports truncation while retaining output within the configured session bound', async () => {
    const backend = new ControlledBackend()
    const service = makeService({ maxSessions: 1, maxOutputBytes: 32 }, async () => backend)

    await service.exec(request('bounded-output'))
    backend.emit('stdout', `head-${'middle-'.repeat(512)}-tail`)

    const partial = await service.write({
      ...writeRequest('codex-terminal-1'),
      chars: '',
      maxOutputTokens: 1_000,
    })

    expect(partial.truncated).toBe(true)
    expect(partial.output).toContain('head-')
    expect(partial.output).not.toContain('middle-middle-middle')
    expect(partial.job_id).toBe('codex-terminal-1')
    expect(service.liveSessionCount).toBe(1)

    backend.finish({ exitCode: 0, signal: null })
    const final = await service.write({ ...writeRequest('codex-terminal-1'), chars: '', maxOutputTokens: 1_000 })
    expect(final.exit_code).toBe(0)
    expect(final.truncated).toBe(true)
    expect(service.liveSessionCount).toBe(0)
  })

  it('bounds a pre-publication output flood and exposes its truncation marker', async () => {
    const service = makeService({ maxSessions: 1, maxOutputBytes: 64 }, async request => {
      const backend = await createPipeBackend({
        ...request,
        executable: process.execPath,
        argv: ['-e', "process.stdout.write('P'.repeat(262144)); setTimeout(() => {}, 5000)"],
      })
      // Let the child produce data while the backend has no service listener.
      await delay(100)
      return backend
    })

    const result = await service.exec(request('pre-publication-flood'))

    expect(result.job_id).toBe('codex-terminal-1')
    expect(result.output).toContain('<output truncated before session publication>')
    expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThanOrEqual(64)
    expect(service.liveSessionCount).toBe(1)
  })
})

function makeService(
  overrides: Partial<ResolvedConfig>,
  backendFactory: BackendFactory,
): ExecSessionService {
  const service = new ExecSessionService({
    executionMode: 'trusted',
    ptyFallback: 'pipe',
    maxSessions: 4,
    defaultYieldTimeMs: 0,
    pollYieldTimeMs: 0,
    maxOutputBytes: 1_024,
    defaultMaxOutputTokens: 100,
    maxOutputTokens: 100,
    rows: 24,
    cols: 80,
    windowsPtyStartupGraceMs: 2_000,
    ...overrides,
  }, shell, backendFactory)
  services.push(service)
  return service
}

function request(command: string) {
  return {
    owner,
    cmd: command,
    yieldTimeMs: 0,
    signal: new AbortController().signal,
  }
}

function writeRequest(jobId: string) {
  return {
    owner,
    jobId,
    chars: '',
    yieldTimeMs: 0,
    signal: new AbortController().signal,
  }
}

class ControlledBackend implements SessionBackend {
  readonly transport = 'pipe' as const
  readonly pid = 100
  readonly exit: Promise<ExitStatus>
  terminated = false
  private readonly listeners = new Set<(stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void>()
  private readonly resolveExit: (status: ExitStatus) => void

  constructor() {
    this.exit = new Promise(resolve => { this.resolveExit = resolve })
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  onData(listener: (stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async write(_data: Uint8Array): Promise<void> {}

  async closeStdin(): Promise<void> {}

  async interrupt(): Promise<void> {
    this.finish({ exitCode: 130, signal: 'SIGINT' })
  }

  async terminate(): Promise<void> {
    this.terminated = true
    this.finish({ exitCode: null, signal: 'SIGTERM' })
  }

  waitForExit(): Promise<ExitStatus> {
    return this.exit
  }

  async waitForQuiescence(): Promise<void> {}

  emit(stream: 'stdout' | 'stderr' | 'pty', text: string): void {
    const bytes = new TextEncoder().encode(text)
    for (const listener of this.listeners) listener(stream, bytes)
  }

  finish(status: ExitStatus): void {
    this.resolveExit(status)
  }
}
