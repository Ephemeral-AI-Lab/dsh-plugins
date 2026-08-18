import type { SideChatTabState } from '../../sidechat/sidechat-types.js'

export function SideChatTabs({ tabs, activeSubagentId, onSelect }: {
  readonly tabs: readonly SideChatTabState[]
  readonly activeSubagentId: string | null
  readonly onSelect: (id: string) => void
}) {
  return (
    <div className="dsh-sidechat-tabs" role="tablist" aria-label="Side chats">
      {tabs.map(tab => (
        <button
          key={tab.subagentId}
          type="button"
          role="tab"
          aria-selected={tab.subagentId === activeSubagentId}
          className={tab.subagentId === activeSubagentId ? 'dsh-sidechat-tab dsh-sidechat-tab-active' : 'dsh-sidechat-tab'}
          onClick={() => { onSelect(tab.subagentId) }}
        >
          <span>{tab.title}</span>
          {tab.unread && <span className="dsh-sidechat-unread" aria-label="Unread">●</span>}
        </button>
      ))}
    </div>
  )
}
