import { useEffect } from 'react'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import type { WorkflowRunMemberData } from './workflow-data.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowAgentMessagesProps = PropsLocale<'workflowDashboard'> & {
  readonly member: WorkflowRunMemberData | undefined
  readonly useWorkflowSession: (sessionId: SessionId | undefined) => ConversationSnapshot | undefined
  readonly warmWorkflowSession: ((sessionId: SessionId) => void) | undefined
}

type MessageKind = 'assistant' | 'reasoning' | 'tool' | 'user'

interface MessageItem {
  readonly key: string
  readonly kind: MessageKind
  readonly text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

function contentText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const text = value
    .filter(isRecord)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .filter((block): block is string => typeof block === 'string')
    .join('\n')
  return clean(text)
}

/** Extract presentation-safe message blocks from the existing child chat snapshot. */
export function workflowAgentMessages(snapshot: ConversationSnapshot | undefined): readonly MessageItem[] {
  const nodes = snapshot?.chat?.nodes.values() ?? []
  const messages: MessageItem[] = []
  for (const node of nodes) {
    const data = node.data
    if (node.kind === 'assistant-step' && isRecord(data)) {
      const messageStart = messages.length
      const blocks = Array.isArray(data.blocks) ? data.blocks : []
      let blockIndex = 0
      for (const block of blocks) {
        if (!isRecord(block)) continue
        const text = clean(block.text)
        if (text === undefined) {
          if (block.kind === 'tool-call') {
            const name = clean(block.name)
            if (name !== undefined) messages.push({ key: `${node.key}:tool:${blockIndex}`, kind: 'tool', text: name })
          }
          blockIndex += 1
          continue
        }
        const kind = block.kind === 'reasoning' ? 'reasoning' : 'assistant'
        messages.push({ key: `${node.key}:${kind}:${blockIndex}`, kind, text })
        blockIndex += 1
      }
      if (messages.length === messageStart && data.status === 'running') {
        messages.push({ key: `${node.key}:working`, kind: 'assistant', text: 'Working…' })
      }
      continue
    }
    if (node.kind === 'input-message' && isRecord(data)) {
      const text = contentText(data.content)
      if (text !== undefined) messages.push({ key: `${node.key}:user`, kind: 'user', text })
      continue
    }
    if (node.kind === 'tool-call' && isRecord(data) && isRecord(data.root)) {
      const name = clean(data.root.name)
      if (name !== undefined) messages.push({ key: `${node.key}:tool`, kind: 'tool', text: name })
    }
  }
  return messages
}

function text(t: WorkflowAgentMessagesProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Show the selected child Session's full, bounded message history. */
export function WorkflowAgentMessages({ member, useWorkflowSession, warmWorkflowSession, t }: WorkflowAgentMessagesProps) {
  useEffect(() => {
    if (member !== undefined) warmWorkflowSession?.(member.childId)
  }, [member?.childId, warmWorkflowSession])

  const snapshot = useWorkflowSession(member?.childId)
  const messages = workflowAgentMessages(snapshot)
  const loading = snapshot === undefined || snapshot.openState === 'cold' || snapshot.openState === 'loading'

  if (member === undefined) return null
  const label = member.label === '' ? text(t, 'detail.unnamedAgent') : member.label
  return (
    <section className={css.detailSection} data-testid="agent-messages">
      <div className={css.messageHistoryBox}>
        <div className={css.messageHistoryHeader}>
          <span className={css.messageHistoryAgent}><span className={css.statusDot} data-status={member.status} aria-hidden />{label}</span>
          <span>{messages.length} {text(t, 'detail.entries')}</span>
        </div>
        {loading && messages.length === 0
          ? <div className={css.messageEmpty}><span className={css.emptyIcon}>◌</span><p>{text(t, 'detail.loadingMessages')}</p></div>
          : messages.length === 0
          ? <div className={css.messageEmpty}><span className={css.emptyIcon}>◌</span><p>{text(t, 'detail.noMessages')}</p></div>
          : <div className={css.messageStream} role="log" aria-live="polite" aria-label={text(t, 'detail.messageStream')}>
            {messages.map(message => (
              <article key={message.key} className={css.messageCard} data-message-kind={message.kind}>
                <div className={css.messageMeta}>
                  <span>{text(t, `message.${message.kind}` as WorkflowDashboardKey)}</span>
                  {message.kind === 'reasoning' && <span>internal</span>}
                </div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>}
      </div>
    </section>
  )
}
