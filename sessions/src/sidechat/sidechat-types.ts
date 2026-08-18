export type SideChatStatus = 'running' | 'idle' | 'finished' | 'error'
export type SideChatResidency = 'live' | 'cold'

export interface SideChatOpenArgs {
  prompt: string
}

export interface SideChatResult {
  subagent_id: string
  message_id: string
  accepted: true
  status: 'running'
}

export interface SideChatTabState {
  readonly subagentId: string
  readonly title: string
  readonly status: SideChatStatus
  readonly residency: SideChatResidency
  readonly canContinue: boolean
  readonly unread: boolean
}

export interface SideChatPanelState {
  readonly mainSessionId: string
  readonly open: boolean
  readonly activeSubagentId: string | null
  readonly tabs: readonly SideChatTabState[]
}

export interface SideChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'tool'
  readonly text: string
}

export interface SideChatConversationSnapshot {
  readonly messages: readonly SideChatMessage[]
  readonly status: SideChatStatus
  readonly residency: SideChatResidency
  readonly canContinue: boolean
}

export function isSideChatResult(value: unknown): value is SideChatResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.subagent_id === 'string'
    && typeof record.message_id === 'string'
    && record.accepted === true
    && record.status === 'running'
}
