import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { herdrBin, runHerdrJson, runHerdrText } from '../src/cli.js'

let dir: string
let bin: string

const FAKE_HERDR = `#!/usr/bin/env bash
case "$1" in
  ok)    echo '{"id":"cli:x","result":{"foo":1,"nested":{"a":"b"}}}' ;;
  err)   echo '{"error":{"code":"agent_not_found","message":"target missing"},"id":"cli:x"}' >&2; exit 1 ;;
  plain) echo 'something broke' >&2; exit 1 ;;
  text)  printf 'hello\\nworld\\n' ;;
  sleep) sleep 30 ;;
  *)     echo "unknown args: $*" >&2; exit 2 ;;
esac
`

function env(overrides: Record<string, string> = {}): Record<string, string> {
  return { HERDR_BIN_PATH: bin, ...overrides }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'herdr-cli-'))
  bin = join(dir, 'herdr')
  writeFileSync(bin, FAKE_HERDR, { mode: 0o755 })
  chmodSync(bin, 0o755)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('herdrBin', () => {
  it('prefers HERDR_BIN_PATH and falls back to PATH lookup', () => {
    expect(herdrBin({ HERDR_BIN_PATH: '/opt/herdr' })).toBe('/opt/herdr')
    expect(herdrBin({})).toBe('herdr')
  })
})

describe('runHerdrJson', () => {
  it('returns the parsed result envelope on success', async () => {
    const out = await runHerdrJson(env(), ['ok'])
    expect(out).toEqual({ ok: true, result: { foo: 1, nested: { a: 'b' } } })
  })

  it('maps exit-1 JSON error envelopes to code/message', async () => {
    const out = await runHerdrJson(env(), ['err'])
    expect(out).toEqual({ ok: false, code: 'agent_not_found', message: 'target missing' })
  })

  it('maps non-JSON stderr failures to cli_error', async () => {
    const out = await runHerdrJson(env(), ['plain'])
    expect(out).toEqual({ ok: false, code: 'cli_error', message: 'something broke' })
  })

  it('reports a missing binary as spawn_failed', async () => {
    const out = await runHerdrJson({ HERDR_BIN_PATH: join(dir, 'missing-herdr') }, ['ok'])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('spawn_failed')
  })

  it('kills a hung child as timeout', async () => {
    const out = await runHerdrJson(env(), ['sleep'], { timeoutMs: 100 })
    expect(out).toEqual({ ok: false, code: 'timeout', message: 'herdr call timed out' })
  })

  it('reports aborts as aborted', async () => {
    const controller = new AbortController()
    const pending = runHerdrJson(env(), ['sleep'], { signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual({ ok: false, code: 'aborted', message: 'herdr call aborted' })
  })

  it('rejects unparseable stdout as bad_output', async () => {
    const out = await runHerdrJson(env(), ['text'])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('bad_output')
  })
})

describe('runHerdrText', () => {
  it('returns raw stdout text', async () => {
    const out = await runHerdrText(env(), ['text'])
    expect(out).toEqual({ ok: true, text: 'hello\nworld\n' })
  })

  it('maps errors the same way as the JSON path', async () => {
    const out = await runHerdrText(env(), ['err'])
    expect(out).toEqual({ ok: false, code: 'agent_not_found', message: 'target missing' })
  })
})
