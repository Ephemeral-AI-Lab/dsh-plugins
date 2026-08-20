import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import { ExecSessionService } from '../../src/session/exec-session-service.js'
import { WindowsPowerShellAdapter } from '../../src/shell/windows-powershell.js'
import type { ResolvedConfig } from '../../src/types.js'

const config: ResolvedConfig = {
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 4,
  defaultYieldTimeMs: 250,
  pollYieldTimeMs: 250,
  maxOutputBytes: 1024 * 1024,
  defaultMaxOutputTokens: 10_000,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

describe('Windows service lifecycle', () => {
  it.runIf(process.platform === 'win32')('runs a trivial PowerShell command through pipes without PTY delay', async () => {
    const service = createService()
    const startedAt = performance.now()
    try {
      const result = await service.exec({
        owner: {},
        cmd: "[Console]::WriteLine('pipe:\u2713')",
        yieldTimeMs: 1_000,
        signal: new AbortController().signal,
      })

      expect(result.exit_code).toBe(0)
      expect(result.output).toContain('pipe:\u2713')
      expect(result.output).not.toMatch(/\u001b/)
      // This catches the previous ~3.2s PTY startup regression while allowing
      // normal Windows PowerShell process startup overhead.
      expect(performance.now() - startedAt).toBeLessThan(1_000)
    } finally {
      await service.dispose()
    }
  }, 30_000)

  it.runIf(process.platform === 'win32')('supports exec_command plus write_stdin through a pipe', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'codex-terminal-\u6D4B\u8BD5-'))
    const service = createService()
    const owner = {}
    try {
      const started = await service.exec({
        owner,
        cmd: "$line = [Console]::In.ReadLine(); [Console]::WriteLine('input:' + $line); [Console]::WriteLine('unicode:\u2713'); [Console]::WriteLine('cwd:' + (Get-Location).Path)",
        workdir,
        yieldTimeMs: 0,
        signal: new AbortController().signal,
      })
      expect(started.job_id).toBeTypeOf('string')

      const completed = await service.write({
        owner,
        jobId: started.job_id!,
        chars: 'hello\n',
        yieldTimeMs: 1_000,
        signal: new AbortController().signal,
      })
      expect(completed.exit_code).toBe(0)
      expect(completed.output).toContain('input:hello')
      expect(completed.output).toContain('unicode:\u2713')
      expect(completed.output).toContain(`cwd:${workdir}`)
    } finally {
      await service.dispose()
      await rm(workdir, { recursive: true, force: true })
    }
  }, 30_000)

  it.runIf(process.platform === 'win32')('supports independent pipe sessions in parallel', async () => {
    const service = createService()
    const owner = {}
    try {
      const [first, second] = await Promise.all([
        service.exec({
          owner,
          cmd: "$line = [Console]::In.ReadLine(); [Console]::WriteLine('first:' + $line)",
          yieldTimeMs: 0,
          signal: new AbortController().signal,
        }),
        service.exec({
          owner,
          cmd: "$line = [Console]::In.ReadLine(); [Console]::WriteLine('second:' + $line)",
          yieldTimeMs: 0,
          signal: new AbortController().signal,
        }),
      ])

      expect(first.job_id).toBeTypeOf('string')
      expect(second.job_id).toBeTypeOf('string')
      expect(first.job_id).not.toBe(second.job_id)

      const [firstDone, secondDone] = await Promise.all([
        service.write({ owner, jobId: first.job_id!, chars: 'one\n', yieldTimeMs: 1_000, signal: new AbortController().signal }),
        service.write({ owner, jobId: second.job_id!, chars: 'two\n', yieldTimeMs: 1_000, signal: new AbortController().signal }),
      ])

      expect(firstDone.output).toContain('first:one')
      expect(secondDone.output).toContain('second:two')
      expect(firstDone.exit_code).toBe(0)
      expect(secondDone.exit_code).toBe(0)
    } finally {
      await service.dispose()
    }
  }, 30_000)

  it.runIf(process.platform === 'win32')('cleans up a live pipe session on disposal', async () => {
    const service = createService()
    try {
      const started = await service.exec({
        owner: {},
        cmd: '$null = [Console]::In.ReadLine()',
        yieldTimeMs: 0,
        signal: new AbortController().signal,
      })
      expect(started.job_id).toBeTypeOf('string')
      expect(service.liveSessionCount).toBe(1)

      await service.dispose()

      expect(service.liveSessionCount).toBe(0)
    } finally {
      await service.dispose()
    }
  }, 30_000)
})

function createService(): ExecSessionService {
  return new ExecSessionService(config, new WindowsPowerShellAdapter(), createPipeBackend)
}
