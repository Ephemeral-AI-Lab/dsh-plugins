import type { OutputLimit, OutputRead } from '../types.js'

export const DEFAULT_TOKEN_BYTES = 4

export function normalizeOutputLimit(limit: OutputLimit, fallback: number): OutputLimit {
  const tokens = Number.isFinite(limit.maxOutputTokens) && limit.maxOutputTokens > 0
    ? Math.floor(limit.maxOutputTokens)
    : fallback
  return { maxOutputTokens: Math.max(1, tokens) }
}

export function markTruncated(read: OutputRead, truncated: boolean): OutputRead {
  return truncated === read.truncated ? read : { ...read, truncated: true }
}
