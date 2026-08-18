import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('DSH bundle contract', () => {
  it('loads the published package name from the bundle patch', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(manifest.name).toBe('dsh-loop')
    expect(patch).toMatch(/^\s*name:\s*['"]?dsh-loop['"]?\s*$/m)
  })
})
