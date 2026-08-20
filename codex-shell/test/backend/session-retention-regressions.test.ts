import { afterEach, describe, expect, it } from 'vitest'
import type { BackendFactory, ExitStatus, ResolvedConfig, SessionBackend, SessionOwner, ShellAdapter } from '../../src/types.js'
import { ExecSessionService } from '../../src/session/exec-session-service.js'
import { delay } from '../../src/session/lifecycle.js'

const config: ResolvedConfig = {
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 4,
  defaultYieldTimeMs: 20,
  pollYieldTimeMs: 100,
  maxOutputBytes: 1_024,
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

const owner: SessionOwner = { ownerId: 'retention-regression-owner' }
const services: ExecSessionService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()))
})

describe('session output and retention regressions', () => {
  it('returns output that arrived between exec_command and the next empty write_stdin poll', async () => {
    const backend = new ControlledBackend()
    const service = makeService(async () => backend)

    const started = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(started.job_id).toBe('codex-shell-1')

    backend.emit('stdout', 'output-after-exec')
    const result = await service.write({ owner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })

    expect(result.output).toContain('output-after-exec')
    expect(result.job_id).toBe('codex-shell-1')
  })

  it('returns already-unread output without waiting the default poll delay', async () => {
    const backend = new ControlledBackend()
    const service = makeService(async () => backend)
    await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    backend.emit('stdout', 'already-buffered')

    const poll = service.write({ owner, jobId: 'codex-shell-1', chars: '', signal: signal() })
    const outcome = await Promise.race([
      poll.then(result => ({ kind: 'result' as const, result })),
      delay(25).then(() => ({ kind: 'timeout' as const })),
    ])

    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') expect(outcome.result.output).toContain('already-buffered')
  })

  it('returns output beyond max_output_tokens across subsequent polls', async () => {
    const backend = new ControlledBackend()
    const service = makeService(async () => backend)
    await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    backend.emit('stdout', 'abcdefghij')

    const chunks: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const result = await service.write({
        owner,
        jobId: 'codex-shell-1',
        chars: '',
        yieldTimeMs: 0,
        maxOutputTokens: 1,
        signal: signal(),
      })
      chunks.push(result.output)
      expect(result.job_id).toBe('codex-shell-1')
    }

    expect(chunks.join('')).toBe('abcdefghij')
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)
    expect((await service.write({ owner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })).exit_code).toBe(0)
  })

  it('retains naturally exited output until an empty write_stdin poll', async () => {
    const backend = new ControlledBackend()
    const service = makeService(async () => backend)
    await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })

    backend.emit('stdout', 'final-output')
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)

    const result = await service.write({ owner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })
    expect(result.output).toContain('final-output')
    expect(result.exit_code).toBe(0)
    expect(service.liveSessionCount).toBe(0)
  })

  it('keeps a completed session alive while token-capped terminal output has unread remainder', async () => {
    const backend = new ControlledBackend()
    const service = makeService(async () => backend)
    await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })

    backend.emit('stdout', Array.from({ length: 160 }, (_, index) => `LINE-${index}\n`).join(''))
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)

    const first = await service.write({
      owner,
      jobId: 'codex-shell-1',
      chars: '',
      yieldTimeMs: 0,
      maxOutputTokens: 100,
      signal: signal(),
    })
    expect(first.truncated).toBe(true)
    expect(first.exit_code).toBe(0)
    expect(first.job_id).toBe('codex-shell-1')
    expect(service.liveSessionCount).toBe(1)

    let last = first
    for (let poll = 0; poll < 10 && last.job_id !== undefined; poll += 1) {
      last = await service.write({
        owner,
        jobId: 'codex-shell-1',
        chars: '',
        yieldTimeMs: 0,
        maxOutputTokens: 100,
        signal: signal(),
      })
    }
    expect(last.job_id).toBeUndefined()
    expect(last.exit_code).toBe(0)
    expect(service.liveSessionCount).toBe(0)
  })

  it('does not delete a naturally exited session after a non-empty write', async () => {
    const backend = new ControlledBackend()
    const service = makeService(async () => backend)
    await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })

    backend.emit('stdout', 'must-survive')
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)

    await expect(service.write({ owner, jobId: 'codex-shell-1', chars: 'late-input', yieldTimeMs: 0, signal: signal() })).rejects.toThrow()
    const result = await service.write({ owner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })
    expect(result.output).toContain('must-survive')
    expect(result.exit_code).toBe(0)
  })

  it('emits one compact natural-exit notification without consuming the session output', async () => {
    const backend = new ControlledBackend()
    const notifications: string[] = []
    const notifyingOwner: SessionOwner = {
      ownerId: 'notification-owner',
      steer(message) {
        notifications.push(message.content[0].text)
      },
    }
    const service = makeService(async () => backend)

    const started = await service.exec({ owner: notifyingOwner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(started.job_id).toBe('codex-shell-1')

    backend.emit('stdout', 'notification-output')
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)

    expect(notifications).toEqual([
      'exec job codex-shell-1 exited with code 0. Call write_stdin with job_id="codex-shell-1" and chars="" to collect the remaining output.',
    ])

    const result = await service.write({ owner: notifyingOwner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })
    expect(result.output).toContain('notification-output')
    expect(result.exit_code).toBe(0)
    expect(notifications).toHaveLength(1)
  })

  it('does not publish a backend after disposal wins the backend-startup race', async () => {
    const backend = new ControlledBackend()
    let signalFactoryStarted!: () => void
    let releaseFactory!: () => void
    const factoryStarted = new Promise<void>(resolve => { signalFactoryStarted = resolve })
    const factoryRelease = new Promise<void>(resolve => { releaseFactory = resolve })
    const factory: BackendFactory = async () => {
      signalFactoryStarted()
      await factoryRelease
      return backend
    }
    const service = makeService(factory)
    const execution = service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })

    await factoryStarted
    await service.dispose()
    releaseFactory()

    await expect(execution).rejects.toThrow(/disposed/i)
    expect(service.liveSessionCount).toBe(0)
    expect(backend.terminated).toBe(true)
  })
})

function makeService(factory: BackendFactory): ExecSessionService {
  const service = new ExecSessionService(config, shell, factory)
  services.push(service)
  return service
}

function signal(): AbortSignal {
  return new AbortController().signal
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
