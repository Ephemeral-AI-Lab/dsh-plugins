import { describe, expect, it } from 'vitest'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import { ExecSessionService } from '../../src/session/exec-session-service.js'
import { WindowsPowerShellAdapter } from '../../src/shell/windows-powershell.js'
import type { ResolvedConfig } from '../../src/types.js'
import { delay } from '../../src/session/lifecycle.js'

const config: ResolvedConfig = {
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 4,
  defaultYieldTimeMs: 25,
  pollYieldTimeMs: 5,
  maxOutputBytes: 16_384,
  defaultMaxOutputTokens: 1_000,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

describe('Windows pipe lifecycle', () => {
  it.runIf(process.platform === 'win32')('polls output emitted after exec_command and returns final exit_code', async () => {
    const service = new ExecSessionService(config, new WindowsPowerShellAdapter(), createPipeBackend)
    const owner = {}
    try {
      const started = await service.exec({
        owner,
        cmd: "Write-Output 'before-poll'; Start-Sleep -Milliseconds 150; Write-Output 'after-poll'",
        yieldTimeMs: 0,
        signal: signal(),
      })
      expect(started.job_id).toBeTypeOf('string')

      await delay(750)
      const result = await service.write({
        owner,
        jobId: started.job_id!,
        chars: '',
        yieldTimeMs: 0,
        signal: signal(),
      })

      expect(result.output).toContain('before-poll')
      expect(result.output).toContain('after-poll')
      expect(result.exit_code).toBe(0)
      expect(service.liveSessionCount).toBe(0)
    } finally {
      await service.dispose()
    }
  }, 30_000)

  it.runIf(process.platform === 'win32')('keeps a naturally exited session readable after a failed post-exit write', async () => {
    const service = new ExecSessionService(config, new WindowsPowerShellAdapter(), createPipeBackend)
    const owner = {}
    try {
      const started = await service.exec({
        owner,
        cmd: "Start-Sleep -Milliseconds 150; Write-Output 'windows-final'",
        yieldTimeMs: 0,
        signal: signal(),
      })
      expect(started.job_id).toBeTypeOf('string')
      await delay(750)

      await expect(service.write({
        owner,
        jobId: started.job_id!,
        chars: 'should-not-delete',
        yieldTimeMs: 0,
        signal: signal(),
      })).rejects.toThrow(/stdin|closed/i)

      const final = await service.write({
        owner,
        jobId: started.job_id!,
        chars: '',
        yieldTimeMs: 0,
        signal: signal(),
      })
      expect(final.output).toContain('windows-final')
      expect(final.exit_code).toBe(0)
    } finally {
      await service.dispose()
    }
  }, 30_000)
})

function signal(): AbortSignal {
  return new AbortController().signal
}
