import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatConversationSnapshot, SideChatMessage, SideChatPanelState, SideChatTabState } from '../../sidechat/sidechat-types.js'
import { SideChatComposer } from './SideChatComposer.js'
import { SideChatConversation } from './SideChatConversation.js'
import { SideChatTabs } from './SideChatTabs.js'
import { SideChatStore } from './sidechat-store.js'
import './sidechat.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export interface SideChatPanelInjected {
  readonly store: SideChatStore
  readonly sendMessage: (mainSessionId: string, subagentId: string, message: string) => Promise<void>
  readonly loadConversation: (mainSessionId: string, subagentId: string) => Promise<SideChatConversationSnapshot>
}

export type SideChatPanelProps = PropsRuntime<'shell.overlay'> & SideChatPanelInjected

export function SideChatPanel({ store, sendMessage, loadConversation, useSessions }: SideChatPanelProps) {
  const all = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const mainSessionId = useSessions(snapshot => snapshot.current)
  const state = mainSessionId === undefined ? undefined : all[String(mainSessionId)]
  const tabIds = state?.tabs.map(tab => tab.subagentId).join('\u0000') ?? ''
  const isOpen = state?.open === true
  useSideChatRefresh(
    mainSessionId === undefined ? undefined : String(mainSessionId),
    state,
    tabIds,
    isOpen,
    store,
    loadConversation,
  )
  if (mainSessionId === undefined) return null
  if (state === undefined || !state.open || state.activeSubagentId === null) return null
  const tab: SideChatTabState | undefined = state.tabs.find(item => item.subagentId === state.activeSubagentId)
  if (tab === undefined) return null
  return <SideChatPanelBody
    key={tab.subagentId}
    mainSessionId={String(mainSessionId)}
    tab={tab}
    state={state}
    store={store}
    sendMessage={sendMessage}
    loadConversation={loadConversation}
  />
}

function useSideChatRefresh(
  mainSessionId: string | undefined,
  state: Readonly<SideChatPanelState> | undefined,
  tabIds: string,
  isOpen: boolean,
  store: SideChatStore,
  loadConversation: SideChatPanelInjected['loadConversation'],
): void {
  useEffect(() => {
    let active = true
    if (mainSessionId === undefined || state === undefined || !isOpen) return () => { active = false }
    const tabs = state.tabs
    const refresh = async (): Promise<void> => {
      await Promise.all(tabs.map(async tab => {
        try {
          const snapshot = await loadConversation(mainSessionId, tab.subagentId)
          if (active) store.settle(mainSessionId, tab.subagentId, snapshot.status, snapshot.residency, snapshot.canContinue)
        } catch {
          if (active) store.settle(mainSessionId, tab.subagentId, 'error', 'cold', true)
        }
      }))
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 4000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [isOpen, loadConversation, mainSessionId, store, tabIds])
}

function SideChatPanelBody({ mainSessionId, tab, state, store, sendMessage, loadConversation }: {
  readonly mainSessionId: string
  readonly tab: SideChatTabState
  readonly state: Readonly<SideChatPanelState>
  readonly store: SideChatStore
  readonly sendMessage: SideChatPanelInjected['sendMessage']
  readonly loadConversation: SideChatPanelInjected['loadConversation']
}) {
  const [messages, setMessages] = useState<readonly SideChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    void loadConversation(mainSessionId, tab.subagentId).then(next => {
      if (active) {
        setMessages(next.messages)
        store.settle(mainSessionId, tab.subagentId, next.status, next.residency, next.canContinue)
        setLoading(false)
      }
    }, () => {
      if (active) {
        setMessages([])
        store.settle(mainSessionId, tab.subagentId, 'error', 'cold', true)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [loadConversation, mainSessionId, tab.subagentId, refresh])
  return (
    <aside className="dsh-sidechat-panel" data-sidechat-panel="" aria-label="Side chats">
      <header className="dsh-sidechat-header">
        <div><h2>Side chats</h2><span>{state.tabs.length} agent{state.tabs.length === 1 ? '' : 's'}</span></div>
        <button type="button" onClick={() => { store.close(mainSessionId) }} aria-label="Close side chats">×</button>
      </header>
      <SideChatTabs tabs={state.tabs} activeSubagentId={state.activeSubagentId} onSelect={id => { store.select(mainSessionId, id) }} />
      <SideChatConversation tab={tab} messages={messages} loading={loading} />
      <SideChatComposer
        disabled={!tab.canContinue}
        onSend={async message => {
          await sendMessage(mainSessionId, tab.subagentId, message)
          setRefresh(value => value + 1)
        }}
      />
    </aside>
  )
}
