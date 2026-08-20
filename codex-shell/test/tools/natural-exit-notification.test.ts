import { afterEach, describe, expect, it } from 'vitest'
import type { BackendFactory, ExitStatus, ResolvedConfig, SessionBackend, SessionOwner, ShellAdapter } from '../../src/types.js'
import { ExecSessionService } from '../../src/session/exec-session-service.js'
import { delay } from '../../src/session/lifecycle.js'

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

describe('natural exec session notifications', () => {
  it('steers the owner and preserves the pollable result', async () => {
    const backend = new ControlledBackend()
    const notices: string[] = []
    const owner: SessionOwner = {
      ownerId: 'idle-notification-owner',
      steer(message) {
        notices.push(message.content[0].text)
      },
    }
    const service = makeService(async () => backend)

    const started = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(started.job_id).toBe('codex-shell-1')
    backend.emit('stdout', 'idle-final')
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)

    expect(notices).toEqual([
      'exec job codex-shell-1 exited with code 0. Call write_stdin with job_id="codex-shell-1" and chars="" to collect the remaining output.',
    ])
    const result = await service.write({ owner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })
    expect(result.output).toContain('idle-final')
    expect(result.exit_code).toBe(0)
  })

  it('steers only once', async () => {
    const backend = new ControlledBackend()
    const steered: string[] = []
    const owner: SessionOwner = {
      ownerId: 'busy-notification-owner',
      steer(message) {
        steered.push(message.content[0].text)
      },
    }
    const service = makeService(async () => backend)

    const started = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(started.job_id).toBe('codex-shell-1')
    backend.finish({ exitCode: 3, signal: null })
    await delay(0)
    await delay(0)

    expect(steered).toHaveLength(1)
    expect(steered[0]).toContain('job_id="codex-shell-1"')
    expect(steered[0]).toContain('chars=""')
  })

  it('keeps polling available when notification delivery throws', async () => {
    const backend = new ControlledBackend()
    const owner: SessionOwner = {
      ownerId: 'failing-notification-owner',
      steer() {
        throw new Error('notification sink unavailable')
      },
    }
    const service = makeService(async () => backend)

    const started = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(started.job_id).toBe('codex-shell-1')
    backend.emit('stdout', 'still-readable')
    backend.finish({ exitCode: 0, signal: null })
    await delay(0)

    const result = await service.write({ owner, jobId: 'codex-shell-1', chars: '', yieldTimeMs: 0, signal: signal() })
    expect(result.output).toContain('still-readable')
    expect(result.exit_code).toBe(0)
  })

  it('does not notify when the command exits before returning a job_id', async () => {
    const ownerNotices: string[] = []
    const owner: SessionOwner = {
      ownerId: 'immediate-exit-owner',
      steer(message) {
        ownerNotices.push(message.content[0].text)
      },
    }
    const service = makeService(async () => {
      const backend = new ControlledBackend()
      backend.onSubscribe = () => {
        backend.emit('stdout', 'immediate-final')
        backend.finish({ exitCode: 0, signal: null })
      }
      return backend
    })

    const result = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(result.job_id).toBeUndefined()
    expect(result.output).toContain('immediate-final')
    expect(result.exit_code).toBe(0)
    expect(ownerNotices).toEqual([])
  })

  it.each(['owner', 'service'] as const)('does not steer during %s teardown', async (scope) => {
    const backend = new ControlledBackend()
    const notices: string[] = []
    const owner: SessionOwner = {
      ownerId: `${scope}-teardown-owner`,
      steer(message) {
        notices.push(message.content[0].text)
      },
    }
    const service = makeService(async () => backend)

    const started = await service.exec({ owner, cmd: 'run', yieldTimeMs: 0, signal: signal() })
    expect(started.job_id).toBe('codex-shell-1')

    if (scope === 'owner') await service.closeOwner(owner)
    else await service.dispose()
    await delay(0)

    expect(notices).toEqual([])
  })
})

function makeService(factory: BackendFactory): ExecSessionService {
  const service = new ExecSessionService(config(), shell, factory)
  services.push(service)
  return service
}

function config(): ResolvedConfig {
  return {
    executionMode: 'trusted',
    ptyFallback: 'pipe',
    maxSessions: 4,
    defaultYieldTimeMs: 0,
    pollYieldTimeMs: 0,
    maxOutputBytes: 1_024,
    defaultMaxOutputTokens: 100,
    rows: 24,
    cols: 80,
    windowsPtyStartupGraceMs: 2_000,
  }
}

function signal(): AbortSignal {
  return new AbortController().signal
}

class ControlledBackend implements SessionBackend {
  readonly transport = 'pipe' as const
  readonly pid = 100
  readonly exit: Promise<ExitStatus>
  onSubscribe: (() => void) | undefined
  private readonly listeners = new Set<(stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void>()
  private readonly resolveExit: (status: ExitStatus) => void

  constructor() {
    this.exit = new Promise(resolve => { this.resolveExit = resolve })
  }

  onData(listener: (stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void): () => void {
    this.listeners.add(listener)
    this.onSubscribe?.()
    return () => this.listeners.delete(listener)
  }

  async write(_data: Uint8Array): Promise<void> {}
  async closeStdin(): Promise<void> {}
  async interrupt(): Promise<void> { this.finish({ exitCode: 130, signal: 'SIGINT' }) }
  async terminate(): Promise<void> { this.finish({ exitCode: null, signal: 'SIGTERM' }) }
  waitForExit(): Promise<ExitStatus> { return this.exit }
  async waitForQuiescence(): Promise<void> {}

  emit(stream: 'stdout' | 'stderr' | 'pty', text: string): void {
    const bytes = new TextEncoder().encode(text)
    for (const listener of this.listeners) listener(stream, bytes)
  }

  finish(status: ExitStatus): void {
    this.resolveExit(status)
  }
}
