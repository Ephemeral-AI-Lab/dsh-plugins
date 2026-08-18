import type { JsonValue } from '@deepseek-ai/dsh-session'

export type SessionSendMode = 'steer' | 'followup'

export interface SessionSendArgs {
  session_id: string
  message: string
  mode?: SessionSendMode
}

export interface SessionSendResult {
  message_id: string
}

export interface CreateSessionModel {
  provider: string
  model: string
  /** Adapter-owned reasoning/thinking effort identifier. */
  reasoningEffort?: string
}

export interface CreateSessionArgs {
  prompt: string
  preset?: string
  model?: CreateSessionModel
  /** Existing absolute directory. */
  cwd?: string
}

export interface CreateSessionResult {
  session_id: string
  accepted: true
  status: 'queued'
  /** Workspace selected for the new session, when it was resolved. */
  workspace_id?: string
  /** Canonical persisted working directory, when one was selected. */
  cwd?: string
}

export type SessionStatus = 'running' | 'idle' | 'cold'

export interface ListStatusArgs {
  /** Exact session to inspect; omitted to list recent sessions. */
  session_id?: string
  /** Number of recent sessions to return when session_id is omitted. */
  recent_n?: number
}

export type CheckedSessionStatus = SessionStatus | 'missing'

export interface SessionStatusView {
  session_id: string
  title?: string
  status: CheckedSessionStatus
  updated_at?: string
}

export interface ListStatusResult {
  /** One row per recent session, or one row for an exact session query. */
  sessions: SessionStatusView[]
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
