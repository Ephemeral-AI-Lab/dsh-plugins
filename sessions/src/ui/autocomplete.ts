export type ReadOptionFlag = '--offset' | '--limit'

export interface ReadOption {
  readonly flag: ReadOptionFlag
  readonly description: string
}

export type SessionsPreview =
  | { readonly kind: 'status' | 'read' }
  | { readonly kind: 'read-options'; readonly sessionId: string; readonly options: readonly ReadOption[] }

export const READ_OPTIONS: readonly ReadOption[] = [
  { flag: '--offset', description: 'Start at a 1-based message offset.' },
  { flag: '--limit', description: 'Limit the number of message blocks.' },
]

/**
 * Resolve the popup state for the sessions slash command without sending the
 * draft to the agent. Read options are offered once a session id is present.
 */
export function previewForDraft(draft: string): SessionsPreview | undefined {
  const input = draft.trim()
  if (/^\/sessions\s*status\s*$/u.test(input)) return { kind: 'status' }
  if (/^\/sessions\s*read\s*$/u.test(input)) return { kind: 'read' }

  const match = /^\/sessions\s*read\s*(\S+)(?:\s+(.*))?$/u.exec(input)
  if (match === null) return undefined

  const sessionId = match[1]
  if (sessionId === undefined) return undefined
  const tail = match[2] ?? ''
  const tokens = tail.trim() === '' ? [] : tail.trim().split(/\s+/u)
  const used = new Set<ReadOptionFlag>()
  for (const token of tokens) {
    const flag = token.split('=', 1)[0]
    if (flag === '--offset' || flag === '--limit') used.add(flag)
  }

  const partial = /(?:^|\s)(--[^\s]*)$/u.exec(tail)?.[1]
  const options = READ_OPTIONS.filter(option => {
    if (used.has(option.flag)) return false
    return partial === undefined || option.flag.startsWith(partial)
  })

  if (options.length === 0) return undefined
  return { kind: 'read-options', sessionId, options }
}

/** Insert one option, replacing a partially typed `--...` token if present. */
export function appendReadOption(draft: string, flag: ReadOptionFlag): string {
  const partial = /(?:^|\s)--[^\s]*$/u.exec(draft)
  if (partial !== null && partial.index !== undefined) {
    const tokenStart = draft[partial.index] === ' ' ? partial.index + 1 : partial.index
    return `${draft.slice(0, tokenStart)}${flag} `
  }
  return `${draft.trimEnd()} ${flag} `
}
