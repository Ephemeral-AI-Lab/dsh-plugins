import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeHerdrSkillProvider, stripFrontmatter } from '../src/skill.js'

let dir: string
let bin: string

const FAKE_SKILL = `#!/usr/bin/env bash
if [ "$1" = "--skill" ]; then
  printf -- '---\\nname: herdr\\n---\\n\\n# Herdr (binary copy)\\n\\nRequires HERDR_ENV=1.\\n'
  exit 0
fi
echo "unhandled: $*" >&2; exit 1
`

function env(overrides: Record<string, string> = {}): Record<string, string> {
  return { HERDR_BIN_PATH: bin, ...overrides }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'herdr-skill-'))
  bin = join(dir, 'herdr')
  writeFileSync(bin, FAKE_SKILL, { mode: 0o755 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('stripFrontmatter', () => {
  it('removes a leading frontmatter block', () => {
    expect(stripFrontmatter('---\nname: herdr\n---\n\n# Body\n')).toBe('# Body')
    expect(stripFrontmatter('---\r\nname: herdr\r\n---\r\n# Body')).toBe('# Body')
  })

  it('returns body unchanged when no frontmatter is present', () => {
    expect(stripFrontmatter('# Body\n')).toBe('# Body')
    expect(stripFrontmatter('---\nnot closed\n# Body')).toBe('---\nnot closed\n# Body')
  })
})

describe('herdr skill provider', () => {
  it('lists one bundled-rank herdr candidate', async () => {
    const provider = makeHerdrSkillProvider({ env: env(), mode: 'auto' })
    expect(provider.name).toBe('dsh-herdr-plus')
    const list = await provider.list({})
    expect(list).toHaveLength(1)
    const entry = (list as readonly Record<string, unknown>[])[0]!
    expect(entry).toMatchObject({
      name: 'herdr',
      provider: 'dsh-herdr-plus',
      source: 'bundled',
      rank: 600,
      invocation: { modelInvocable: true, userInvocable: true },
    })
    expect(entry.resourceBase).toMatchObject({ kind: 'directory' })
  })

  it('serves the binary-provided body plus the addendum in auto mode', async () => {
    const provider = makeHerdrSkillProvider({ env: env(), mode: 'auto' })
    const [entry] = await provider.list({})
    const def = await provider.get(entry as never, {})
    expect(def?.name).toBe('herdr')
    expect(def?.content).toContain('# Herdr (binary copy)')
    expect(def?.content).toContain('## Sibling dsh / Mayfly sessions')
    expect(def?.content).not.toContain('name: herdr\n---')
  })

  it('falls back to the vendored copy when the binary is missing', async () => {
    const provider = makeHerdrSkillProvider({
      env: env({ HERDR_BIN_PATH: join(dir, 'missing') }),
      mode: 'auto',
    })
    const [entry] = await provider.list({})
    const def = await provider.get(entry as never, {})
    expect(def?.content).toContain('# Herdr')
    expect(def?.content).toContain('HERDR_ENV')
    expect(def?.content).toContain('## Sibling dsh / Mayfly sessions')
  })

  it('bundled mode never spawns the binary', async () => {
    const provider = makeHerdrSkillProvider({ env: env(), mode: 'bundled' })
    const [entry] = await provider.list({})
    const def = await provider.get(entry as never, {})
    expect(def?.content).toContain('# Herdr')
    expect(def?.content).not.toContain('binary copy')
  })

  it('returns undefined when neither source is available', async () => {
    const provider = makeHerdrSkillProvider({
      env: env({ HERDR_BIN_PATH: join(dir, 'missing') }),
      mode: 'auto',
      skillsUrl: new URL(`file://${join(dir, 'empty')}/`),
    })
    const [entry] = await provider.list({})
    expect(await provider.get(entry as never, {})).toBeUndefined()
  })
})
