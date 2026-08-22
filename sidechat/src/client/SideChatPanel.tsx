import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkbenchPanelProps } from 'dsh-workbench-ui/client'
import type { SideChatId, SideChatMessageView, SideChatOutputBlock } from '../types.js'
import type { SideChatStore, SideChatTab } from './store.js'
import css from './SideChatPanel.module.css'

export interface SideChatPanelProps extends WorkbenchPanelProps {
  store: SideChatStore
  sessions: ISessions
}

export function SideChatPanel({ store, sessions, close: _close }: SideChatPanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const list = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot, sessions.list.getSnapshot)
  const active = state.activeId === null ? undefined : state.tabs.find(tab => tab.id === state.activeId)
  const centeredId = list.current
  const centeredTitle = centeredId === undefined ? undefined : list.byId[centeredId]?.displayTitle ?? centeredId
  const opened = useRef(false)
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (opened.current || centeredId === undefined || centeredTitle === undefined) return
    opened.current = true
    void store.create(String(centeredId), centeredTitle).catch(() => {})
  }, [centeredId, centeredTitle, store])

  useEffect(() => {
    if (active?.remote.status !== 'running') return
    void store.pull(active.id)
    const timer = setInterval(() => { void store.pull(active.id) }, 350)
    return () => { clearInterval(timer) }
  }, [active?.id, active?.remote.status, store])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [active?.remote.messages.length, active?.remote.partialAssistant])

  const draft = active === undefined ? '' : drafts[active.id] ?? ''
  const setDraft = (value: string): void => {
    if (active === undefined) return
    setDrafts(current => ({ ...current, [active.id]: value }))
  }
  const submit = (delivery: 'followup' | 'steer'): void => {
    if (active === undefined || draft.trim().length === 0) return
    const text = draft.trim()
    setDraft('')
    void store.submit(active.id, text, delivery)
  }
  const create = (): void => {
    if (centeredId === undefined || centeredTitle === undefined) return
    void store.create(String(centeredId), centeredTitle).catch(() => {})
  }

  return (
    <section className={css.root} aria-label="Side chat">
      <header className={css.tabs}>
        <div className={css.tabList} role="tablist" aria-label="Side chats">
          {state.tabs.map(tab => (
            <div className={css.tabShell} key={tab.id} data-active={tab.id === state.activeId || undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === state.activeId}
                className={css.tab}
                onClick={() => { store.select(tab.id) }}
              >
                <span className={css.tabTitle}>{tab.title}</span>
              </button>
              <button
                type="button"
                className={css.tabClose}
                aria-label={`Close side chat ${tab.title}`}
                onClick={() => { void store.close(tab.id) }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={css.newTab}
          aria-label="New side chat for centered conversation"
          title="New side chat"
          disabled={centeredId === undefined || state.opening}
          onClick={create}
        >
          <PlusIcon />
        </button>
      </header>

      {active === undefined
        ? <EmptyPanel canCreate={centeredId !== undefined} opening={state.opening} onCreate={create} />
        : <>
            <AnchorBar tab={active} refresh={() => { void store.refreshAnchor(active.id) }} />
            <Conversation tab={active} bottomRef={bottomRef} />
            <Composer
              tab={active}
              draft={draft}
              setDraft={setDraft}
              submit={submit}
              stop={() => { void store.stop(active.id) }}
            />
          </>}
    </section>
  )
}

function EmptyPanel({ canCreate, opening, onCreate }: {
  canCreate: boolean
  opening: boolean
  onCreate: () => void
}) {
  return (
    <div className={css.emptyPanel}>
      <ChatIcon />
      <h3>Side chat</h3>
      <p>Temporary, read-only conversation context. Nothing is added to session history.</p>
      <button type="button" disabled={!canCreate || opening} onClick={onCreate}>
        {opening ? 'Opening…' : 'New side chat'}
      </button>
    </div>
  )
}

function AnchorBar({ tab, refresh }: { tab: SideChatTab; refresh: () => void }) {
  const captured = useMemo(() => new Date(tab.anchor.capturedAt).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  }), [tab.anchor.capturedAt])
  return (
    <div className={css.anchor}>
      <div>
        <span className={css.anchorLabel}>Read-only context</span>
        <strong>{tab.title}</strong>
        <span className={css.anchorMeta}>
          {tab.anchor.kind} · {tab.anchor.provider}/{tab.anchor.model} · captured {captured}
        </span>
      </div>
      <button
        type="button"
        className={css.iconButton}
        aria-label="Refresh read-only context"
        title="Refresh context"
        disabled={tab.loading}
        onClick={refresh}
      >
        <RefreshIcon />
      </button>
    </div>
  )
}

function Conversation({ tab, bottomRef }: {
  tab: SideChatTab
  bottomRef: React.RefObject<HTMLDivElement>
}) {
  const empty = tab.remote.messages.length === 0 && tab.remote.partialAssistant === undefined
  return (
    <div className={css.conversation} aria-live="polite">
      {empty && (
        <div className={css.emptyConversation}>
          <ChatIcon />
          <h3>Side chat</h3>
          <p>This chat starts empty with a frozen, read-only view of the centered conversation.</p>
          <span>It disappears when closed or DSH restarts.</span>
        </div>
      )}
      {tab.remote.messages.map(message => <MessageBubble key={message.id} message={message} />)}
      {tab.remote.partialAssistant !== undefined && (
        <div className={`${css.message} ${css.assistant}`} data-streaming="">
          <div className={css.messageLabel}>Side chat</div>
          <Blocks blocks={tab.remote.partialAssistant} />
        </div>
      )}
      {tab.remote.queuedCount > 0 && (
        <div className={css.queued}>{tab.remote.queuedCount} follow-up{tab.remote.queuedCount === 1 ? '' : 's'} queued</div>
      )}
      {tab.error !== undefined && <div className={css.error} role="alert">{tab.error}</div>}
      <div ref={bottomRef} />
    </div>
  )
}

function MessageBubble({ message }: { message: SideChatMessageView }) {
  return (
    <div className={`${css.message} ${message.role === 'user' ? css.user : css.assistant}`}>
      <div className={css.messageLabel}>{message.role === 'user' ? 'You' : 'Side chat'}</div>
      <Blocks blocks={message.content} />
      {message.interrupted && <span className={css.interrupted}>Interrupted</span>}
    </div>
  )
}

function Blocks({ blocks }: { blocks: readonly SideChatOutputBlock[] }) {
  return <>{blocks.map((block, index) => block.type === 'reasoning'
    ? <details key={index} className={css.reasoning}><summary>Reasoning</summary><pre>{block.text}</pre></details>
    : <p key={index}>{block.text}</p>)}</>
}

function Composer({ tab, draft, setDraft, submit, stop }: {
  tab: SideChatTab
  draft: string
  setDraft: (value: string) => void
  submit: (delivery: 'followup' | 'steer') => void
  stop: () => void
}) {
  const running = tab.remote.status === 'running'
  const submitForm = (event: FormEvent): void => {
    event.preventDefault()
    submit('followup')
  }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit('followup')
  }
  return (
    <form className={css.composer} onSubmit={submitForm}>
      <label htmlFor={`sidechat-input-${tab.id}`} className={css.srOnly}>Message side chat</label>
      <textarea
        id={`sidechat-input-${tab.id}`}
        value={draft}
        rows={3}
        placeholder={running ? 'Queue a follow-up or steer…' : 'Ask about this conversation…'}
        onChange={event => { setDraft(event.target.value) }}
        onKeyDown={keyDown}
      />
      <div className={css.composerActions}>
        <span>{running ? 'Responding' : 'Read-only · memory only'}</span>
        <div>
          {running && (
            <button type="button" className={css.secondaryButton} onClick={stop}>Stop</button>
          )}
          {running && (
            <button
              type="button"
              className={css.secondaryButton}
              disabled={draft.trim().length === 0}
              onClick={() => { submit('steer') }}
            >
              Steer
            </button>
          )}
          <button type="submit" className={css.primaryButton} disabled={draft.trim().length === 0}>
            {running ? 'Queue follow-up' : 'Send'}
          </button>
        </div>
      </div>
    </form>
  )
}

function PlusIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden><path d="m4 4 8 8m0-8-8 8" /></svg>
}

function RefreshIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden><path d="M13 6a5 5 0 1 0 .2 3M13 3v3h-3" /></svg>
}

function ChatIcon() {
  return <svg className={css.chatIcon} viewBox="0 0 24 24" aria-hidden><path d="M5 18.5A8 8 0 1 1 19.5 14L21 20l-6-1.5A8 8 0 0 1 5 18.5Z" /><path d="M12 8v6M9 11h6" /></svg>
}

export type { SideChatId, SessionId }
