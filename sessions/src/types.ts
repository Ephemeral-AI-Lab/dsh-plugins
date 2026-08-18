import type { JsonValue } from '@deepseek-ai/dsh-session'

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
