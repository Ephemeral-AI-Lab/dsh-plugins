import type { JsonValue } from '@deepseek-ai/dsh-session'

export interface ListSessionsArgs {
  limit?: number
}

export type SessionStatus = 'running' | 'idle' | 'cold'

export interface SessionView {
  session_id: string
  title?: string
  status: SessionStatus
  updated_at: string
}

export interface ListSessionsResult {
  sessions: SessionView[]
}

export interface CheckSessionStatusArgs {
  session_id: string
}

export type CheckedSessionStatus = SessionStatus | 'missing'

export interface SessionStatusView {
  session_id: string
  title?: string
  status: CheckedSessionStatus
  updated_at?: string
}

export interface ReadSessionArgs {
  session_id: string
  /** 1-based message offset over the reconstructed conversation surface. */
  offset?: number
  /** Maximum number of message blocks to return. */
  limit?: number
}

/** One canonical, JSON-safe message block reconstructed from the session surface. */
export type ReadSessionMessage = Record<string, JsonValue>

export interface ReadSessionResult {
  session_id: string
  offset: number
  messages: ReadSessionMessage[]
  total_messages: number
}
