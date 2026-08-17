import { useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LoopProjection, LoopRecord } from '../types.js'
import css from './LoopsView.module.css'

export interface LoopsViewInjected {
  execute: (line: string) => Promise<unknown>
}

type AwaitingProjection = { id: string }

type LoopsViewProps = ConvViewProps & InjectFace<LoopsViewInjected>

export function LoopsView({ useProjection, execute }: LoopsViewProps) {
  const projection = useProjection('loop') as LoopProjection | undefined
  const loops = useMemo(() => [...(projection?.loops ?? [])].sort((a, b) => a.next_at - b.next_at), [projection])
  const [now, setNow] = useState(() => Date.now())
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [awaiting, setAwaiting] = useState<AwaitingProjection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (awaiting === null) return
    if (!loops.some(loop => loop.id === awaiting.id)) {
      setAwaiting(null)
      setPending(null)
      setConfirmingId(null)
    }
  }, [awaiting, loops])

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

  return (
    <main className={css.root} aria-labelledby="loop-title">
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>Session scoped</p>
          <h1 id="loop-title">Loops</h1>
          <p className={css.description}>Loops created with <code>/loop</code> appear here.</p>
        </div>
      </header>

      {error !== null && <p className={css.error} role="alert">{error}</p>}

      {loops.length === 0 ? (
        <section className={css.empty} aria-live="polite">
          <h2>No loops yet</h2>
          <p>Use <code>/loop 60 check the build</code> in Chat to create one.</p>
        </section>
      ) : (
        <section className={css.grid} aria-label="Active loops">
          {loops.map(loop => (
            <LoopCard
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
        </section>
      )}

    </main>
  )
}

function LoopCard({ loop, now, busy, confirming, onAskDelete, onCancelDelete, onDelete }: {
  loop: LoopRecord
  now: number
  busy: boolean
  confirming: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  const overdue = loop.next_at < now
  const due = loop.next_at === now
  return (
    <article className={css.card}>
      <div className={css.cardHeader}>
        <div>
          <h2>{promptHeading(loop.prompt)}</h2>
          <span className={overdue || due ? css.statusDue : css.status}>
            {overdue ? 'Overdue' : due ? 'Due now' : formatNext(loop.next_at, now)}
          </span>
        </div>
        <div className={css.cardActions}>
          {confirming ? (
            <>
              <button type="button" className={css.ghostButton} onClick={onCancelDelete} disabled={busy}>Cancel</button>
              <button type="button" className={css.dangerButton} onClick={onDelete} disabled={busy}>{busy ? 'Deleting…' : 'Delete loop'}</button>
            </>
          ) : (
            <button type="button" className={css.dangerButton} onClick={onAskDelete} disabled={busy}>Delete</button>
          )}
        </div>
      </div>
      {confirming && <p className={css.confirmation} role="alert">Delete this loop? Future deliveries will stop.</p>}
      <p className={css.prompt}>{loop.prompt}</p>
      <footer className={css.meta}>
        <span>{formatInterval(loop.time_in_seconds)}</span>
        <span>Message inbox</span>
      </footer>
    </article>
  )
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `Every ${seconds}s`
  if (seconds % 60 === 0 && seconds < 3_600) return `Every ${seconds / 60}m`
  if (seconds % 3_600 === 0) return `Every ${seconds / 3_600}h`
  return `Every ${seconds}s`
}

function promptHeading(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/u)[0]!
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77).trimEnd()}…`
}

function formatNext(nextAt: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((nextAt - now) / 1_000))
  return `Next in ${formatRemaining(seconds)}`
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
