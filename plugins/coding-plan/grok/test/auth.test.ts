import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { currentGrokAuth, parseGrokAuth } from '../src/auth.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function document(access: string, expiresAt: string, refresh = 'refresh-1'): string {
  return JSON.stringify({
    'https://auth.x.ai::client': {
      key: access,
      refresh_token: refresh,
      expires_at: expiresAt,
      profile: 'preserved',
    },
  })
}

describe('Grok auth cache', () => {
  it('maps the local xAI OAuth cache to an OAuth credential', () => {
    const loaded = parseGrokAuth(document('access-1', '2030-01-01T00:00:00.000Z'))
    expect(loaded.credential).toMatchObject({
      type: 'oauth',
      access: 'access-1',
      refresh: 'refresh-1',
    })
  })

  it('refreshes the cache atomically and preserves unrelated fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-grok-plan-'))
    roots.push(root)
    const path = join(root, 'auth.json')
    await writeFile(path, document('access-1', '2020-01-01T00:00:00.000Z'))
    const refresh = async (): Promise<OAuthCredential> => ({
      type: 'oauth',
      access: 'access-2',
      refresh: 'refresh-2',
      expires: 3_000_000_000_000,
    })

    const loaded = await currentGrokAuth(path, refresh, 2_000_000_000_000)

    expect(loaded?.accessToken).toBe('access-2')
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      'https://auth.x.ai::client': { key: string; refresh_token: string; profile: string }
    }
    expect(persisted['https://auth.x.ai::client']).toEqual(expect.objectContaining({
      key: 'access-2',
      refresh_token: 'refresh-2',
      profile: 'preserved',
    }))
  })
})
