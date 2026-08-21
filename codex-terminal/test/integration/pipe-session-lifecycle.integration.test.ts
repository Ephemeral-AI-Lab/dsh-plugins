import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { BackendFactory, ResolvedConfig, ShellAdapter } from '../../src/types.js'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import { ExecSessionService, MaxSessionsError } from '../../src/session/exec-session-service.js'
import { createShellAdapter } from '../../src/shell/index.js'
import { delay } from '../../src/session/lifecycle.js'
import { callTool, createRegisteredToolHarness, execution } from '../support/registered-tools.js'

const fixture = fileURLToPath(new URL('../fixtures/registered-tool-child.mjs', import.meta.url))

describe('pipe session lifecycle integration', () => {
  it('makes output produced between exec_command and write_stdin visible to the next poll', async () => {
    const harness = createRegisteredToolHarness()
    const agent = harness.agent('pipe-output-agent')
    try {
      const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
      const jobId = started.value?.job_id
      expect(jobId).toBeTypeOf('string')

      // The fixture writes and exits while no write_stdin call is active.
      await delay(250)

      const polled = await callTool(harness.writeStdin, {
        job_id: jobId,
        chars: '',
        yield_time_ms: 0,
      }, execution(agent))

      expect(polled.isError).toBe(false)
      expect(polled.value).toMatchObject({
        output: expect.stringContaining('PASS slow'),
        exit_code: 0,
      })
    } finally {
      await harness.service.dispose()
    }
  })

  it('does not destroy an unread result when input is written after natural exit', async () => {
    const harness = createRegisteredToolHarness()
    const agent = harness.agent('post-exit-write-agent')
    try {
      const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
      const jobId = started.value?.job_id
      expect(jobId).toBeTypeOf('string')
      await delay(250)

      const writeAfterExit = await callTool(harness.writeStdin, {
        job_id: jobId,
        chars: 'late input',
        yield_time_ms: 0,
      }, execution(agent))
      expect(writeAfterExit.isError).toBe(true)

      const finalPoll = await callTool(harness.writeStdin, {
        job_id: jobId,
        chars: '',
        yield_time_ms: 0,
      }, execution(agent))
      expect(finalPoll.isError).toBe(false)
      expect(finalPoll.value).toMatchObject({
        output: expect.stringContaining('PASS slow'),
        exit_code: 0,
      })
    } finally {
      await harness.service.dispose()
    }
  })

  it('does not silently lose unread completed results under session capacity', async () => {
    const service = createFixtureService({ maxSessions: 2 })
    const owner = service.ownerFor({})
    try {
      const first = await service.exec({ owner, cmd: 'slow', yieldTimeMs: 0, signal: signal() })
      const second = await service.exec({ owner, cmd: 'slow', yieldTimeMs: 0, signal: signal() })
      expect(first.job_id).toBeTypeOf('string')
      expect(second.job_id).toBeTypeOf('string')
      await delay(250)

      await expect(service.exec({ owner, cmd: 'slow', yieldTimeMs: 0, signal: signal() }))
        .rejects.toBeInstanceOf(MaxSessionsError)

      const firstResult = await service.write({ owner, jobId: first.job_id!, chars: '', yieldTimeMs: 0, signal: signal() })
      const secondResult = await service.write({ owner, jobId: second.job_id!, chars: '', yieldTimeMs: 0, signal: signal() })
      expect(firstResult).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
      expect(secondResult).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })

      const replacement = await service.exec({ owner, cmd: 'slow', yieldTimeMs: 0, signal: signal() })
      expect(replacement.job_id).toBeTypeOf('string')
      await service.write({ owner, jobId: replacement.job_id!, chars: '', yieldTimeMs: 1_000, signal: signal() })
    } finally {
      await service.dispose()
    }
  })

  it('terminates the spawned child when the service is disposed', async () => {
    let pid: number | undefined
    const factory: BackendFactory = async request => {
      const backend = await createPipeBackend(request)
      pid = backend.pid
      return backend
    }
    const service = new ExecSessionService(config({ maxSessions: 2 }), createShellAdapter({}), factory)
    try {
      const owner = service.ownerFor({})
      const started = await service.exec({
        owner,
        cmd: waitForInputCommand(),
        yieldTimeMs: 0,
        signal: signal(),
      })
      expect(started.job_id).toBeTypeOf('string')
      expect(pid).toBeTypeOf('number')

      await service.dispose()
      await waitForProcessExit(pid!)
      expect(service.liveSessionCount).toBe(0)
    } finally {
      await service.dispose()
    }
  }, 30_000)
})

function createFixtureService(overrides: Partial<ResolvedConfig> = {}): ExecSessionService {
  const shell: ShellAdapter = {
    async resolve() {
      return { executable: process.execPath, oneShotArgs: command => [fixture, command], interactiveArgs: () => [] }
    },
    oneShotArgs: command => [fixture, command],
    interactiveArgs: () => [],
  }
  return new ExecSessionService(config(overrides), shell, createPipeBackend)
}

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    executionMode: 'trusted',
    ptyFallback: 'pipe',
    maxSessions: 8,
    defaultYieldTimeMs: 25,
    pollYieldTimeMs: 5,
    maxOutputBytes: 16_384,
    defaultMaxOutputTokens: 1_000,
    maxOutputTokens: 1_000,
    rows: 24,
    cols: 80,
    windowsPtyStartupGraceMs: 2_000,
    ...overrides,
  }
}

function signal(): AbortSignal {
  return new AbortController().signal
}

function waitForInputCommand(): string {
  return process.platform === 'win32'
    ? '$null = [Console]::In.ReadLine()'
    : 'read input'
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await delay(50)
  }
  throw new Error(`child process ${pid} is still alive after service disposal`)
}
