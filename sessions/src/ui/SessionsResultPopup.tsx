import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { appendReadOption, previewForDraft, type ReadOption } from './autocomplete.js'
import type { SessionPopupRow, SessionsPopupController } from './controller.js'
import css from './SessionsResultPopup.module.css'

export interface SessionsResultPopupInjected {
  readonly controller: SessionsPopupController
  readonly open: (sessionId: SessionId) => void
}

export type SessionsResultPopupProps =
  PropsRuntime<'conversation.input.overlay'> & SessionsResultPopupInjected

export function SessionsResultPopup({ controller, open, useInput, useSessions, inputActions }: SessionsResultPopupProps) {
  const state = useSyncExternalStore(
    listener => controller.state.subscribe(listener),
    () => controller.state.getSnapshot(),
  )
  const draft = useInput(input => input.draft)
  const sessions = useSessions(snapshot => snapshot)
  const cardRef = useRef<HTMLDivElement>(null)
  const preview = previewForDraft(draft)
  const previewRows = preview === undefined || preview.kind === 'read-options'
    ? []
    : sessions.ids.map(sessionId => {
      const session = sessions.byId[sessionId]
      if (session === undefined) {
        return { title: String(sessionId), status: '', updatedAt: '', sessionId: String(sessionId) }
      }
      return {
        title: session.displayTitle || session.title || String(sessionId),
        status: session.running ? 'running' : 'idle',
        updatedAt: session.updatedAt > 0 ? new Date(session.updatedAt).toISOString() : '',
        sessionId: String(sessionId),
      }
    })

  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target) === true) return
      controller.dismiss()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        controller.dismiss()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [controller, state.open])

  if (preview?.kind === 'read-options') {
    return (
      <section ref={cardRef} className={css.card} data-sessions-autocomplete="" aria-label="Read session options">
        <header className={css.header}>
          <div className={css.headingGroup}>
            <h2 className={css.title}>Read options</h2>
            <p className={css.subtitle}>Optional range for {preview.sessionId}</p>
          </div>
        </header>
        {preview.options.length === 0
          ? <p className={css.empty}>Both options are already present.</p>
          : <div className={css.optionList} role="listbox">{preview.options.map(option => (
            <ReadOptionRow
              key={option.flag}
              option={option}
              draft={draft}
              insert={inputActions.setDraft}
            />
          ))}</div>}
      </section>
    )
  }

  if (preview !== undefined) {
    const loading = sessions.phase === 'pending'
    const count = previewRows.length
    return (
      <section ref={cardRef} className={css.card} data-sessions-hint="" aria-label="Sessions">
        <header className={css.header}>
          <div className={css.headingGroup}>
            <h2 className={css.title}>
              {preview.kind === 'status'
                ? 'Choose a session'
                : preview.kind === 'read'
                  ? 'Choose a session to read'
                  : 'Session results'}
            </h2>
            <p className={css.subtitle}>
              {loading ? 'Loading sessions…' : `${count} session${count === 1 ? '' : 's'}`}
            </p>
          </div>
        </header>
        {loading
          ? <p className={css.empty}>Loading sessions…</p>
          : count === 0
            ? <p className={css.empty}>No sessions found.</p>
            : <div className={css.list} role="list">{previewRows.map(row => <SessionRow key={`${row.sessionId}:${row.title}`} row={row} open={open} />)}</div>}
      </section>
    )
  }

  if (!state.open) return null

  return (
    <section ref={cardRef} className={css.card} data-sessions-popup="" aria-label="Sessions">
      <header className={css.header}>
        <div className={css.headingGroup}>
          <h2 className={css.title}>{state.kind === 'error' ? 'Sessions' : state.kind === 'read' ? `Session ${state.sessionId}` : 'Session results'}</h2>
          {state.kind === 'success' && (
            <p className={css.subtitle}>{state.rows.length === 0 ? 'No sessions found' : `${state.rows.length} session${state.rows.length === 1 ? '' : 's'}`}</p>
          )}
        </div>
        <button type="button" className={css.close} onClick={() => { controller.dismiss() }} aria-label="Close sessions">
          ×
        </button>
      </header>

      {state.kind === 'error'
        ? <p className={css.error} role="alert">{state.error}</p>
        : state.kind === 'read'
          ? <pre className={css.readContent}>{state.content}</pre>
        : state.rows.length === 0
          ? <p className={css.empty}>No sessions found.</p>
          : <div className={css.list} role="list">{state.rows.map(row => <SessionRow key={`${row.sessionId}:${row.title}`} row={row} open={open} />)}</div>}
    </section>
  )
}

function ReadOptionRow({
  option,
  draft,
  insert,
}: {
  readonly option: ReadOption
  readonly draft: string
  readonly insert: (text: string) => void
}) {
  return (
    <button
      type="button"
      className={css.optionRow}
      role="option"
      onMouseDown={event => { event.preventDefault() }}
      onClick={() => { insert(appendReadOption(draft, option.flag)) }}
    >
      <code>{option.flag}</code>
      <span>{option.description}</span>
    </button>
  )
}

function SessionRow({ row, open }: { readonly row: SessionPopupRow; readonly open: (sessionId: SessionId) => void }) {
  const copy = useSessionIdCopy(row.sessionId)
  const statusClass = row.status === 'running'
    ? css.statusRunning
    : row.status === 'idle'
      ? css.statusIdle
      : row.status === 'cold'
        ? css.statusCold
        : css.statusUnknown

  return (
    <div className={css.row} role="listitem">
      <div className={css.rowMain}>
        {row.sessionId === ''
          ? <span className={css.rowTitle} title={row.title}>{row.title}</span>
          : <button
            type="button"
            className={css.rowLink}
            title={`Open ${row.sessionId}`}
            onClick={() => { open(row.sessionId as SessionId) }}
          >
            {row.title}
          </button>}
        {row.status !== '' && <span className={`${css.status} ${statusClass}`}>{row.status}</span>}
      </div>
      <div className={css.rowMeta}>
        {row.updatedAt !== '' && <span>{formatSessionTime(row.updatedAt)}</span>}
        {row.sessionId !== '' && (
          <span className={css.sessionIdControl}>
            <code title={row.sessionId}>{row.sessionId}</code>
            <Tooltip label={copy.copied ? 'Copied' : 'Copy session ID'} side="bottom">
              <button
                type="button"
                className={css.copyButton}
                aria-label={copy.copied ? 'Copied session ID' : 'Copy session ID'}
                onClick={copy.onCopy}
              >
                {copy.copied ? <IconCheckOutline16 size={12} /> : <IconCopyOutline16 size={12} />}
              </button>
            </Tooltip>
          </span>
        )}
      </div>
    </div>
  )
}

function useSessionIdCopy(text: string): { copied: boolean; onCopy: () => void } {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then(ok => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, text])
  return { copied, onCopy }
}

function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
