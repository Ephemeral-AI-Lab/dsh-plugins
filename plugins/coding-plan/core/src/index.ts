import { readFile, stat } from 'node:fs/promises'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const MAX_AUTH_BYTES = 1024 * 1024
const REFRESH_SKEW_MS = 5 * 60 * 1000

export interface LoadedOAuthFile<T> {
  accessToken: string
  expiresAt: number
  credential: OAuthCredential
  document: T
}

export type ParseOAuthFile<T> = (raw: string) => LoadedOAuthFile<T>
export type UpdateOAuthFile<T> = (document: T, refreshed: OAuthCredential, now: number) => T
export type RefreshOAuth = (credential: OAuthCredential) => Promise<OAuthCredential>

export async function readOAuthFile<T>(
  authPath: string,
  parse: ParseOAuthFile<T>,
  label: string,
): Promise<LoadedOAuthFile<T> | undefined> {
  let metadata
  try {
    metadata = await stat(authPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!metadata.isFile()) throw new Error(`${label}: auth cache is not a regular file`)
  if (metadata.size > MAX_AUTH_BYTES) throw new Error(`${label}: auth cache is unexpectedly large`)
  return parse(await readFile(authPath, 'utf8'))
}

export async function currentOAuthFile<T>(
  authPath: string,
  parse: ParseOAuthFile<T>,
  update: UpdateOAuthFile<T>,
  refresh: RefreshOAuth,
  label: string,
  now = Date.now(),
): Promise<LoadedOAuthFile<T> | undefined> {
  const initial = await readOAuthFile(authPath, parse, label)
  if (initial === undefined || initial.expiresAt > now + REFRESH_SKEW_MS) return initial
  return withFileLock(authPath, async () => {
    const current = await readOAuthFile(authPath, parse, label)
    if (current === undefined || current.expiresAt > now + REFRESH_SKEW_MS) return current
    const refreshed = await refresh(current.credential)
    const next = update(current.document, refreshed, now)
    await writeFileAtomic(authPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    return parse(JSON.stringify(next))
  })
}
