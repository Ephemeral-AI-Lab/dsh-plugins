import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('DSH bundle contract', () => {
  it('ships the package-resolvable patch and prebuilt runtime without install lifecycle scripts', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(manifest.name).toBe('dsh-loop')
    expect(manifest.version).toBe('0.1.2')
    expect(manifest.license).toBe('MIT')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports['./client'].types).toBe('./lib/types/ui/index.d.ts')
    expect(patch).toMatch(/^\s*name:\s*['"]?dsh-loop['"]?\s*$/m)
    for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(manifest.scripts?.[lifecycle]).toBeUndefined()
    }
    expect(manifest.files).toContain('lib')
    expect(await readFile(new URL('../LICENSE', import.meta.url), 'utf8')).toMatch(/^MIT License/m)
    await access(new URL('../lib/index.js', import.meta.url))
    const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(client).not.toMatch(/(?:\/private\/tmp|\/Users\/|[A-Za-z]:\\\\)/)
  })
})
