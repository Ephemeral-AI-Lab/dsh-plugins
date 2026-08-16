import { describe, expect, it } from 'vitest'
import { createPipeBackend } from '../src/backend/pipe-backend.js'
import { createNodePtyBackend } from '../src/backend/node-pty-backend.js'
import { createPtyFirstFactory } from '../src/backend/pty-backend.js'
import type { BackendSpawnRequest, ExitStatus, SessionBackend } from '../src/types.js'
import { WindowsPowerShellAdapter } from '../src/shell/windows-powershell.js'

const nodeRequest: BackendSpawnRequest = {
  executable: process.execPath,
  argv: ['-e', "process.stdout.write('pipe-\u2713')"],
  cwd: process.cwd(),
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

describe('backend boundaries', () => {
  it('runs an explicit-argv pipe process and preserves Unicode output', async () => {
    const backend = await createPipeBackend(nodeRequest)
    const chunks: Uint8Array[] = []
    backend.onData((_stream, bytes) => chunks.push(bytes))
    const exit = await backend.waitForExit()
    await backend.waitForQuiescence()
    expect(exit.exitCode).toBe(0)
    expect(new TextDecoder().decode(concat(chunks))).toContain('pipe-\u2713')
  })

  it('uses the configured pipe fallback when PTY creation fails', async () => {
    const fake = new NoopBackend()
    const factory = createPtyFirstFactory(
      'pipe',
      async () => { throw new Error('simulated PTY failure') },
      async () => fake,
    )
    await expect(factory(nodeRequest)).resolves.toBe(fake)
  })

  it.runIf(process.platform === 'win32')('allocates the default Windows PTY backend', async () => {
    const shell = await new WindowsPowerShellAdapter().resolve()
    const backend = await createNodePtyBackend({
      executable: shell.executable,
      argv: shell.oneShotArgs("[Console]::WriteLine('pty-\u2713')"),
      cwd: process.cwd(),
      rows: 24,
      cols: 80,
      windowsPtyStartupGraceMs: 2_000,
    })
    const chunks: Uint8Array[] = []
    backend.onData((_stream, bytes) => chunks.push(bytes))
    const exit = await backend.waitForExit()
    expect(exit.exitCode).toBe(0)
    expect(new TextDecoder().decode(concat(chunks))).toContain('pty-\u2713')
  })
})

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

class NoopBackend implements SessionBackend {
  readonly transport = 'pipe' as const
  readonly pid = undefined
  private readonly exitResult: Promise<ExitStatus> = Promise.resolve({ exitCode: 0, signal: null })

  onData(_listener: (stream: 'stdout' | 'stderr' | 'pty', data: Uint8Array) => void): () => void { return () => {} }
  async write(_data: Uint8Array): Promise<void> {}
  async closeStdin(): Promise<void> {}
  async interrupt(): Promise<void> {}
  async terminate(): Promise<void> {}
  waitForExit(): Promise<ExitStatus> { return this.exitResult }
  async waitForQuiescence(): Promise<void> {}
}
