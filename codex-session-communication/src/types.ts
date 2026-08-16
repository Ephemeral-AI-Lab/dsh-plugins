import type { JsonValue } from '@deepseek-ai/dsh-session'

export interface CreateSessionArgs {
  prompt: string
}

export interface CreateSessionResult {
  session_id: string
}

export interface SendMessageArgs {
  session_id: string
  message: string
}

export interface SendMessageResult {
  message_id: string
}

export interface WaitSessionsArgs {
  session_ids: string[]
  after?: Record<string, number>
  timeout_ms?: number
}

export type SessionStatus = 'running' | 'idle' | 'cold' | 'missing' | 'error'

export interface SessionSnapshot {
  session_id: string
  status: SessionStatus
  last_seq: number
  changed: boolean
}

export interface WaitSessionsResult {
  sessions: SessionSnapshot[]
  timed_out: boolean
}

export interface ReadSessionArgs {
  session_id: string
  after_seq?: number
  limit?: number
}

export interface ReadSessionResult {
  events: JsonValue[]
  next_seq: number
  has_more: boolean
}

export interface ListSessionsArgs {
  limit?: number
}

export interface SessionSummary {
  session_id: string
  status: 'running' | 'idle' | 'cold'
  updated_at: string
}

export interface ListSessionsResult {
  sessions: SessionSummary[]
}
