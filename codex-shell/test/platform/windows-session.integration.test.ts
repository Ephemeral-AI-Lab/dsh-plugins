import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPtyFirstFactory } from '../../src/backend/pty-backend.js'
import { ExecSessionService } from '../../src/session/exec-session-service.js'
import { WindowsPowerShellAdapter } from '../../src/shell/windows-powershell.js'
import type { ResolvedConfig } from '../../src/types.js'

const config: ResolvedConfig = {
  executionMode: 'trusted',
  ptyFallback: 'error',
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
  it.runIf(process.platform === 'win32')('starts a PTY session, writes stdin, and preserves Unicode/workdir', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'codex-shell-\u6D4B\u8BD5-'))
    const service = new ExecSessionService(
      config,
      new WindowsPowerShellAdapter(),
      createPtyFirstFactory('error'),
    )
    const owner = {}
    try {
      const started = await service.exec({
        owner,
        cmd: "$line = [Console]::In.ReadLine(); [Console]::WriteLine('input:' + $line); [Console]::WriteLine('unicode:\u2713')",
        workdir,
        yieldTimeMs: 100,
        signal: new AbortController().signal,
      })
      expect(started.session_id).toBeTypeOf('number')

      const completed = await service.write({
        owner,
        sessionId: started.session_id!,
        chars: 'hello\r\n',
        yieldTimeMs: 2_000,
        signal: new AbortController().signal,
      })
      expect(completed.exit_code).toBe(0)
      expect(completed.output).toContain('input:hello')
      expect(completed.output).toContain('unicode:\u2713')

      const cwd = await service.exec({
        owner,
        cmd: '(Get-Location).Path',
        workdir,
        yieldTimeMs: 5_000,
        signal: new AbortController().signal,
      })
      expect(cwd.output).toContain(workdir)
    } finally {
      await service.dispose()
      await rm(workdir, { recursive: true, force: true })
    }
  }, 30_000)
})
