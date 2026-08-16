import { afterEach, describe, expect, it } from 'vitest'
import type { BackendFactory, ExitStatus, ResolvedConfig, SessionBackend, SessionOwner, ShellAdapter } from '../../src/types.js'
import { ExecSessionService, SessionOwnershipError, UnknownSessionError } from '../../src/session/exec-session-service.js'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import { delay } from '../../src/session/lifecycle.js'

const config: ResolvedConfig = {
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 4,
  defaultYieldTimeMs: 20,
  pollYieldTimeMs: 5,
  maxOutputBytes: 1024,
  defaultMaxOutputTokens: 100,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

const shell: ShellAdapter = {
  async resolve() {
    return { executable: 'fixture-shell', oneShotArgs: command => [command], interactiveArgs: () => [] }
  },
  oneShotArgs: command => [command],
  interactiveArgs: () => [],
}

const services: ExecSessionService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()))
})

describe('ExecSessionService', () => {
  it('keeps a live session for polling and serializes writes', async () => {
    const backend = new FixtureBackend(false)
    const service = makeService(async () => backend)
    const owner = ownerWithCleanup()

    const started = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: new AbortController().signal })
    expect(started.session_id).toBe(1)

    const first = service.write({ owner, sessionId: 1, chars: 'one', yieldTimeMs: 0, signal: new AbortController().signal })
    const second = service.write({ owner, sessionId: 1, chars: 'two', yieldTimeMs: 0, signal: new AbortController().signal })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ session_id: 1 }),
      expect.objectContaining({ session_id: 1 }),
    ])
    expect(backend.maxConcurrentWrites).toBe(1)
    expect(backend.writes).toEqual(['one', 'two'])
  })

  it('rejects a different owner and removes completed sessions', async () => {
    const service = makeService(async () => new FixtureBackend(true))
    const owner = ownerWithCleanup()
    const other = ownerWithCleanup()
    const result = await service.exec({ owner, cmd: 'run', yieldTimeMs: 20, signal: new AbortController().signal })
    expect(result.exit_code).toBe(0)
    expect(result.session_id).toBeUndefined()
    await expect(service.write({ owner: other, sessionId: 1, chars: '', signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(UnknownSessionError)

    const live = makeService(async () => new FixtureBackend(false))
    const started = await live.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: new AbortController().signal })
    await expect(live.write({ owner: other, sessionId: started.session_id!, chars: '', signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(SessionOwnershipError)
  })

  it('returns output and the nonzero exit code after a pipe stdin write', async () => {
    const actualShell: ShellAdapter = {
      async resolve() {
        return { executable: '/bin/sh', oneShotArgs: command => ['-c', command], interactiveArgs: () => [] }
      },
      oneShotArgs: command => ['-c', command],
      interactiveArgs: () => [],
    }
    const service = new ExecSessionService(config, actualShell, createPipeBackend)
    services.push(service)

    const owner = ownerWithCleanup()
    const started = await service.exec({
      owner,
      cmd: "read answer; echo 'FAIL: incorrect number'; exit 1",
      yieldTimeMs: 0,
      signal: new AbortController().signal,
    })
    const result = await service.write({
      owner,
      sessionId: started.session_id!,
      chars: '000000\n',
      yieldTimeMs: 1_000,
      signal: new AbortController().signal,
    })

    expect(result.output).toContain('FAIL: incorrect number')
    expect(result.exit_code).toBe(1)
  })

  it('closes sessions through the actual owner context effect and plugin disposal', async () => {
    const backend = new FixtureBackend(false)
    const service = makeService(async () => backend)
    const owner = ownerWithCleanup()
    const anonymous = service.ownerFor(undefined)
    await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: new AbortController().signal })
    await service.exec({ owner: anonymous, cmd: 'run', yieldTimeMs: 0, signal: new AbortController().signal })
    expect(service.liveSessionCount).toBe(2)

    await owner.cleanup!()
    expect(service.liveSessionCount).toBe(1)
    expect(backend.terminated).toBe(true)

    await service.dispose()
    expect(service.liveSessionCount).toBe(0)
    expect(backend.terminated).toBe(true)
  })
})

function makeService(factory: BackendFactory): ExecSessionService {
  const service = new ExecSessionService(config, shell, factory)
  services.push(service)
  return service
}

function ownerWithCleanup(): SessionOwner & {
  cleanup?: () => Promise<void>
  ctx: { effect(body: () => () => Promise<void>): void }
} {
  const owner = {} as SessionOwner & {
    cleanup?: () => Promise<void>
    ctx: { effect(body: () => () => Promise<void>): void }
  }
  owner.ctx = {
    effect(body: () => () => Promise<void>): void {
      owner.cleanup = body()
    },
  }
  return owner
}

class FixtureBackend implements SessionBackend {
  readonly transport = 'pipe' as const
  readonly pid = 100
  readonly writes: string[] = []
  readonly outputListeners = new Set<(stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void>()
  readonly exit: Promise<ExitStatus>
  maxConcurrentWrites = 0
  private concurrentWrites = 0
  private readonly exitResolve: (status: ExitStatus) => void
  private isTerminated = false

  constructor(autoExit: boolean) {
    this.exit = new Promise(resolve => { this.exitResolve = resolve })
    if (autoExit) {
      queueMicrotask(() => {
        this.emit('stdout', 'done')
        this.exitResolve({ exitCode: 0, signal: null })
      })
    }
  }

  onData(listener: (stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void): () => void {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  async write(data: Uint8Array): Promise<void> {
    this.concurrentWrites += 1
    this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.concurrentWrites)
    await delay(5)
    this.writes.push(new TextDecoder().decode(data))
    this.emit('stdout', `received:${this.writes.at(-1)}`)
    this.concurrentWrites -= 1
  }

  async closeStdin(): Promise<void> {}

  async interrupt(): Promise<void> {
    this.exitResolve({ exitCode: 130, signal: 'SIGINT' })
  }

  async terminate(): Promise<void> {
    this.isTerminated = true
    this.exitResolve({ exitCode: null, signal: 'SIGTERM' })
  }

  waitForExit(): Promise<ExitStatus> { return this.exit }

  async waitForQuiescence(): Promise<void> { await delay(1) }

  get terminated(): boolean { return this.isTerminated }

  private emit(stream: 'stdout' | 'stderr' | 'pty', text: string): void {
    const bytes = new TextEncoder().encode(text)
    for (const listener of this.outputListeners) listener(stream, bytes)
  }
}
