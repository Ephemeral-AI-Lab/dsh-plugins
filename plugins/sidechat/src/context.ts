import {
  deriveEventMessage,
  foldRequestHeader,
  foldSurface,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type { Message } from '@deepseek-ai/dsh-llm'

export interface StableMessages {
  messages: Message[]
  throughSeq: number
}

/** Reconstruct the exact message surface through the latest completed step. */
export function stableMessages(events: readonly SessionEvent[]): StableMessages {
  const boundary = events.findLast(event => event.type === 'step/end')
  if (boundary === undefined) return { messages: [], throughSeq: -1 }
  const prefix = events.slice(0, boundary.seq + 1)
  const surface = foldSurface(prefix)
  const messages: Message[] = []
  for (const seq of surface.nodes) {
    const event = prefix[seq]
    if (event === undefined) throw new Error(`surface references missing event ${String(seq)}`)
    const message = deriveEventMessage(event)
    if (message !== null) messages.push(structuredClone(message))
  }
  return { messages, throughSeq: boundary.seq }
}

export function sideChatKind(header: SessionHeader): 'main' | 'fork' | 'subagent' {
  if (header.origin === 'subagent') return 'subagent'
  return header.parentSession === undefined ? 'main' : 'fork'
}

export function requestRoute(events: readonly SessionEvent[]): {
  provider: string
  model: string
  reasoningEffort?: string
} | undefined {
  const config = foldRequestHeader(events)?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) return undefined
  return {
    provider: config.provider,
    model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) },
  }
}
