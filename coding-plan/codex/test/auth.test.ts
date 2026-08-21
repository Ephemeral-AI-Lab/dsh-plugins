import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { currentCodexAuth, parseCodexAuth } from '../src/auth.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function jwt(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString('base64url')
  return `header.${payload}.signature`
}

function document(access: string, refresh = 'refresh-1'): string {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: access,
      refresh_token: refresh,
      account_id: 'account-1',
      id_token: 'preserved-id-token',
    },
  })
}

describe('Codex auth cache', () => {
  it('maps a ChatGPT cache without exposing unrelated fields', () => {
    const loaded = parseCodexAuth(document(jwt(2_000_000)))
    expect(loaded.credential).toMatchObject({
      type: 'oauth',
      refresh: 'refresh-1',
      accountId: 'account-1',
      expires: 2_000_000,
    })
  })

  it('refreshes an expiring cache atomically and preserves its id token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-plan-'))
    roots.push(root)
    const path = join(root, 'auth.json')
    await writeFile(path, document(jwt(1_000_000)))
    const refresh = async (): Promise<OAuthCredential> => ({
      type: 'oauth',
      access: jwt(3_000_000),
      refresh: 'refresh-2',
      expires: 3_000_000,
      accountId: 'account-1',
    })

    const loaded = await currentCodexAuth(path, refresh, 900_000)

    expect(loaded?.accessToken).toBe(jwt(3_000_000))
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      tokens: { refresh_token: string; id_token: string }
    }
    expect(persisted.tokens).toEqual(expect.objectContaining({
      refresh_token: 'refresh-2',
      id_token: 'preserved-id-token',
    }))
  })
})

