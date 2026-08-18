import type { SideChatMessage, SideChatTabState } from '../../sidechat/sidechat-types.js'

export type { SideChatMessage } from '../../sidechat/sidechat-types.js'

export function SideChatConversation({ tab, messages, loading }: {
  readonly tab: SideChatTabState
  readonly messages: readonly SideChatMessage[]
  readonly loading: boolean
}) {
  return (
    <section className="dsh-sidechat-conversation" aria-label={`${tab.title} conversation`}>
      <div className="dsh-sidechat-child-id"><code>{tab.subagentId}</code></div>
      <div className="dsh-sidechat-state">{tab.status} · {tab.residency}</div>
      {loading && <p className="dsh-sidechat-empty">Loading conversation…</p>}
      {!loading && messages.length === 0 && <p className="dsh-sidechat-empty">No messages yet.</p>}
      <div className="dsh-sidechat-messages">
        {messages.map(message => (
          <article key={message.id} className={`dsh-sidechat-message dsh-sidechat-message-${message.role}`}>
            <strong>{message.role}</strong>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
