import type { CommandResult } from '@deepseek-ai/dsh-commands/types'

export interface SessionPopupRow {
  readonly title: string
  readonly status: string
  readonly updatedAt: string
  readonly sessionId: string
}

export type SessionsPopupState =
  | { readonly open: false }
  | { readonly open: true; readonly kind: 'success'; readonly rows: readonly SessionPopupRow[] }
  | { readonly open: true; readonly kind: 'read'; readonly sessionId: string; readonly content: string }
  | { readonly open: true; readonly kind: 'error'; readonly error: string }

const CLOSED: SessionsPopupState = { open: false }

interface PopupStore<T> {
  readonly getSnapshot: () => T
  readonly subscribe: (listener: () => void) => () => void
  readonly set: (value: T) => void
}

export class SessionsPopupController {
  readonly state: PopupStore<SessionsPopupState> = createPopupStore(CLOSED)

  show(result: CommandResult): void {
    if (result.kind === 'error') {
      this.state.set({ open: true, kind: 'error', error: result.text })
      return
    }

    const text = result.text?.trim() ?? ''
    const read = parseReadResult(text)
    if (read !== undefined) {
      this.state.set({ open: true, kind: 'read', ...read })
      return
    }
    const lines = text === '' || text === 'No sessions found.'
      ? []
      : text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
    this.state.set({ open: true, kind: 'success', rows: lines.map(parseSessionLine) })
  }

  dismiss(): void {
    this.state.set(CLOSED)
  }
}

function createPopupStore<T>(initial: T): PopupStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: next => {
      if (Object.is(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}

function parseSessionLine(line: string): SessionPopupRow {
  const parts = line.split(' · ')
  if (parts.length < 4) {
    return { title: line, status: '', updatedAt: '', sessionId: '' }
  }
  const sessionId = parts.pop() ?? ''
  const updatedAt = parts.pop() ?? ''
  const status = parts.pop() ?? ''
  return { title: parts.join(' · '), status, updatedAt, sessionId }
}

function parseReadResult(text: string): { sessionId: string; content: string } | undefined {
  if (!/\((?:Showing messages \d+-\d+ of \d+|End of session - total \d+ messages)\)$/u.test(text)) return undefined
  const match = /^Session ([^\n]+)\n([\s\S]*)$/u.exec(text)
  if (match === null) return undefined
  return { sessionId: match[1]!, content: match[2]! }
}
