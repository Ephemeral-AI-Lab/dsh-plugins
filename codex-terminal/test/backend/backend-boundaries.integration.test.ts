import { describe, expect, it } from 'vitest'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import type { BackendSpawnRequest } from '../../src/types.js'

const nodeRequest: BackendSpawnRequest = {
  executable: process.execPath,
  argv: ['-e', "process.stdout.write('pipe-\u2713')"],
  cwd: process.cwd(),
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

describe('pipe backend boundaries', () => {
  it('runs an explicit-argv pipe process and preserves Unicode output', async () => {
    const backend = await createPipeBackend(nodeRequest)
    const chunks: Uint8Array[] = []
    backend.onData((_stream, bytes) => chunks.push(bytes))
    const exit = await backend.waitForExit()
    await backend.waitForQuiescence()
    expect(backend.transport).toBe('pipe')
    expect(exit.exitCode).toBe(0)
    expect(new TextDecoder().decode(concat(chunks))).toContain('pipe-\u2713')
  })

  it('keeps stdin writable for a persistent pipe session', async () => {
    const backend = await createPipeBackend({
      ...nodeRequest,
      argv: ['-e', "let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write('echo:' + input))"],
    })
    const chunks: Uint8Array[] = []
    backend.onData((_stream, bytes) => chunks.push(bytes))

    await backend.write(new TextEncoder().encode('hello from pipe'))
    await backend.closeStdin()
    const exit = await backend.waitForExit()
    await backend.waitForQuiescence()

    expect(exit.exitCode).toBe(0)
    expect(new TextDecoder().decode(concat(chunks))).toContain('echo:hello from pipe')
  })

  it('preserves separate stdout and stderr streams', async () => {
    const backend = await createPipeBackend({
      ...nodeRequest,
      argv: ['-e', "process.stdout.write('stdout'); process.stderr.write('stderr')"],
    })
    const outputs: Partial<Record<'stdout' | 'stderr', string>> = {}
    backend.onData((stream, bytes) => {
      if (stream === 'stdout' || stream === 'stderr') {
        outputs[stream] = (outputs[stream] ?? '') + new TextDecoder().decode(bytes)
      }
    })
    const exit = await backend.waitForExit()
    await backend.waitForQuiescence()

    expect(exit.exitCode).toBe(0)
    expect(outputs.stdout).toContain('stdout')
    expect(outputs.stderr).toContain('stderr')
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
