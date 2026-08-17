import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LoopProjection, LoopRecord } from '../types.js'
import css from './LoopsView.module.css'

export interface LoopsViewInjected {
  execute: (line: string) => Promise<unknown>
}

type AwaitingProjection = { id: string }

type LoopsViewProps = PropsRuntime<'conversation.input.dock'> & LoopsViewInjected

export function LoopsView({ useProjection, execute }: LoopsViewProps) {
  const projection = useProjection('loop') as LoopProjection | undefined
  const loops = useMemo(() => [...(projection?.loops ?? [])].sort((a, b) => a.next_at - b.next_at), [projection?.loops])
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [awaiting, setAwaiting] = useState<AwaitingProjection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const listId = useId()

  useEffect(() => {
    if (loops.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [loops.length])

  useEffect(() => {
    setNow(Date.now())
  }, [projection?.loops])

  useEffect(() => {
    if (loops.length < 3 && expanded) setExpanded(false)
  }, [expanded, loops.length])

  useEffect(() => {
    if (!expanded || loops.length < 3) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return
      setExpanded(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded, loops.length])

  useEffect(() => {
    const watchedId = awaiting?.id ?? pending ?? confirmingId
    if (watchedId !== null && !loops.some(loop => loop.id === watchedId)) {
      setAwaiting(null)
      setPending(null)
      setConfirmingId(null)
      setError(null)
    }
  }, [awaiting, confirmingId, loops, pending])

  const remove = async (id: string): Promise<void> => {
    setPending(id)
    setError(null)
    try {
      assertCommandSucceeded(await execute(`/loop delete ${id}`))
      setAwaiting({ id })
    } catch (reason: unknown) {
      setError(errorText(reason))
      setPending(null)
    }
  }

  if (loops.length === 0) return null

  const collapsed = loops.length >= 3 && !expanded
  const showList = loops.length < 3 || expanded
  const nearest = loops[0]!

  return (
    <section ref={rootRef} className={css.root} data-testid="loop-dock" data-loop-dock="" aria-label="Active loops">
      {loops.length >= 3 && (
        <div className={css.summary}>
          <span className={css.glyph} aria-hidden>↻</span>
          <span className={css.summaryText}>{loops.length} active loops · {formatNext(nearest.next_at, now)}</span>
          <button
            type="button"
            className={css.button}
            aria-controls={listId}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand loops' : 'Collapse loops'}
            onClick={() => setExpanded(value => !value)}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      )}

      {showList && (
        <ul id={listId} className={css.list} aria-label="Loop list">
          {loops.map(loop => (
            <LoopRow
              key={loop.id}
              loop={loop}
              now={now}
              busy={pending === loop.id}
              confirming={confirmingId === loop.id}
              onAskDelete={() => {
                setConfirmingId(loop.id)
                setError(null)
              }}
              onCancelDelete={() => setConfirmingId(null)}
              onDelete={() => void remove(loop.id)}
            />
          ))}
        </ul>
      )}

      {error !== null && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}

function LoopRow({ loop, now, busy, confirming, onAskDelete, onCancelDelete, onDelete }: {
  loop: LoopRecord
  now: number
  busy: boolean
  confirming: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  const overdue = loop.next_at <= now
  return (
    <li className={css.row} data-loop-id={loop.id}>
      <span className={css.glyph} aria-hidden>↻</span>
      <span className={css.interval}>every {formatInterval(loop.time_in_seconds)}</span>
      <span
        className={overdue ? css.statusDue : css.status}
        aria-label={overdue ? 'overdue' : formatNext(loop.next_at, now)}
      >
        {overdue ? 'overdue' : formatNext(loop.next_at, now)}
      </span>
      <span className={css.prompt} title={loop.prompt}>{loop.prompt}</span>
      <div className={css.actions}>
        {confirming ? (
          <>
            <button type="button" className={css.button} onClick={onCancelDelete} disabled={busy}>Cancel</button>
            <button type="button" className={css.dangerButton} onClick={onDelete} disabled={busy}>{busy ? 'Deleting…' : 'Delete loop'}</button>
          </>
        ) : (
          <button type="button" className={css.dangerButton} onClick={onAskDelete} disabled={busy}>Delete</button>
        )}
      </div>
      {confirming && (
        <div className={css.confirmation} role="group" aria-label="Delete confirmation">
          <p role="alert">Delete this loop? Future deliveries will stop.</p>
        </div>
      )}
    </li>
  )
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds % 60 === 0 && seconds < 3_600) return `${seconds / 60}m`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`
  return `${seconds}s`
}

function formatNext(nextAt: number, now: number): string {
  if (nextAt <= now) return 'overdue'
  const seconds = Math.max(1, Math.ceil((nextAt - now) / 1_000))
  return `next in ${formatRemaining(seconds)}`
}

function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds % 60 === 0 && seconds < 3_600) return `${seconds / 60}m`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`
  return `${seconds}s`
}

function assertCommandSucceeded(result: unknown): void {
  if (!isRecord(result)) throw new Error('The loop command did not return a result.')
  if (result.ok === false) {
    const error = isRecord(result.error) ? result.error.message : undefined
    throw new Error(typeof error === 'string' ? error : 'The loop command failed.')
  }
  if (result.ok !== true || result.value === undefined) {
    throw new Error('The loop command was not recognized.')
  }
  if (!isRecord(result.value) || !isRecord(result.value.result)) throw new Error('The loop command failed.')
  if (result.value.result.kind === 'error') {
    const text = result.value.result.text
    throw new Error(typeof text === 'string' ? text : 'The loop command failed.')
  }
  if (result.value.result.kind !== 'success') throw new Error('The loop command failed.')
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
