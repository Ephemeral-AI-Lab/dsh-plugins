import type { OAuthCredential } from '@earendil-works/pi-ai'
import {
  currentOAuthFile,
  readOAuthFile,
  type LoadedOAuthFile,
} from 'dsh-coding-plan-core'

interface GrokAuthEntry {
  key: string
  refresh_token: string
  expires_at: string
  [key: string]: unknown
}

interface GrokAuthDocument {
  [provider: string]: unknown
}

export type LoadedGrokAuth = LoadedOAuthFile<GrokAuthDocument>
export type RefreshOAuth = (credential: OAuthCredential) => Promise<OAuthCredential>

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`grok-coding-plan: Grok auth cache is missing ${field}`)
  }
  return value
}

function entry(root: Record<string, unknown>): [string, GrokAuthEntry] {
  for (const [provider, value] of Object.entries(root)) {
    const candidate = object(value)
    if (!provider.startsWith('https://auth.x.ai::') || candidate === undefined) continue
    if (typeof candidate['key'] !== 'string' || typeof candidate['refresh_token'] !== 'string') continue
    if (typeof candidate['expires_at'] !== 'string') continue
    return [provider, candidate as GrokAuthEntry]
  }
  throw new Error('grok-coding-plan: Grok auth cache has no xAI OAuth entry')
}

export function parseGrokAuth(raw: string): LoadedGrokAuth {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new Error('grok-coding-plan: Grok auth cache is not valid JSON')
  }
  const root = object(decoded)
  if (root === undefined) throw new Error('grok-coding-plan: Grok auth cache is not an object')
  const [, auth] = entry(root)
  const accessToken = requiredString(auth.key, 'xAI key')
  const refresh = requiredString(auth.refresh_token, 'xAI refresh token')
  const expiresAt = Date.parse(requiredString(auth.expires_at, 'xAI expiry'))
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('grok-coding-plan: Grok auth cache has an invalid xAI expiry')
  }
  return {
    accessToken,
    expiresAt,
    credential: { type: 'oauth', access: accessToken, refresh, expires: expiresAt },
    document: decoded as GrokAuthDocument,
  }
}

export function readGrokAuth(authPath: string): Promise<LoadedGrokAuth | undefined> {
  return readOAuthFile(authPath, parseGrokAuth, 'grok-coding-plan: Grok')
}

export function currentGrokAuth(
  authPath: string,
  refresh: RefreshOAuth,
  now = Date.now(),
): Promise<LoadedGrokAuth | undefined> {
  return currentOAuthFile(
    authPath,
    parseGrokAuth,
    (document, refreshed): GrokAuthDocument => {
      const root = object(document)
      if (root === undefined) throw new Error('grok-coding-plan: Grok auth cache is not an object')
      const [provider, current] = entry(root)
      const accessToken = requiredString(refreshed.access, 'refreshed xAI access token')
      const refreshToken = requiredString(refreshed.refresh, 'refreshed xAI refresh token')
      if (!Number.isFinite(refreshed.expires) || refreshed.expires <= 0) {
        throw new Error('grok-coding-plan: refreshed xAI token has no valid expiry')
      }
      return {
        ...root,
        [provider]: {
          ...current,
          key: accessToken,
          refresh_token: refreshToken,
          expires_at: new Date(refreshed.expires).toISOString(),
        },
      }
    },
    refresh,
    'grok-coding-plan: Grok',
    now,
  )
}
