import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { currentOAuthFile, type LoadedOAuthFile } from '../src/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Document {
  access: string
  refresh: string
  expires: number
  preserved: string
}

function parse(raw: string): LoadedOAuthFile<Document> {
  const document = JSON.parse(raw) as Document
  return {
    accessToken: document.access,
    expiresAt: document.expires,
    credential: {
      type: 'oauth',
      access: document.access,
      refresh: document.refresh,
      expires: document.expires,
    },
    document,
  }
}

describe('currentOAuthFile', () => {
  it('refreshes under the file lock and persists the updated credential', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-coding-plan-core-'))
    roots.push(root)
    const path = join(root, 'auth.json')
    await writeFile(path, JSON.stringify({ access: 'old', refresh: 'refresh-1', expires: 1, preserved: 'yes' }))
    const refresh = async (): Promise<OAuthCredential> => ({
      type: 'oauth',
      access: 'new',
      refresh: 'refresh-2',
      expires: 3_000_000_000_000,
    })

    const loaded = await currentOAuthFile(
      path,
      parse,
      (document, credential) => ({
        ...document,
        access: credential.access,
        refresh: credential.refresh,
        expires: credential.expires,
      }),
      refresh,
      'core-test',
      2,
    )

    expect(loaded?.accessToken).toBe('new')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      access: 'new',
      refresh: 'refresh-2',
      expires: 3_000_000_000_000,
      preserved: 'yes',
    })
  })
})
