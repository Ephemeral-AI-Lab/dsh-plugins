import { useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LoopProjection, LoopRecord } from '../types.js'
import css from './LoopsView.module.css'

export interface LoopsViewInjected {
  execute: (line: string) => Promise<unknown>
}

interface LoopFormState {
  title: string
  prompt: string
  timeInSeconds: string
  allowSteer: boolean
}

type AwaitingProjection =
  | { kind: 'create' | 'update'; id?: string; expected: LoopFormState }
  | { kind: 'delete'; id: string }

type LoopsViewProps = ConvViewProps & InjectFace<LoopsViewInjected>

const EMPTY_FORM: LoopFormState = {
  title: '',
  prompt: '',
  timeInSeconds: '60',
  allowSteer: true,
}

export function LoopsView({ useProjection, execute }: LoopsViewProps) {
  const projection = useProjection('claude-code-loop') as LoopProjection | undefined
  const loops = useMemo(() => [...(projection?.loops ?? [])].sort((a, b) => a.next_at - b.next_at), [projection])
  const [now, setNow] = useState(() => Date.now())
  const [form, setForm] = useState<LoopFormState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
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
    if (awaiting.kind === 'delete') {
      if (!loops.some(loop => loop.id === awaiting.id)) {
        setAwaiting(null)
        setPending(null)
        setConfirmingId(null)
      }
      return
    }
    const projected = awaiting.id === undefined
      ? loops.find(loop => loop.title === awaiting.expected.title
        && loop.prompt === awaiting.expected.prompt
        && loop.time_in_seconds === Number(awaiting.expected.timeInSeconds)
        && loop.allow_steer === awaiting.expected.allowSteer)
      : loops.find(loop => loop.id === awaiting.id)
    if (projected !== undefined
      && projected.title === awaiting.expected.title
      && projected.prompt === awaiting.expected.prompt
      && projected.time_in_seconds === Number(awaiting.expected.timeInSeconds)
      && projected.allow_steer === awaiting.expected.allowSteer) {
      setAwaiting(null)
      setPending(null)
      setForm(null)
      setEditingId(null)
      setError(null)
    }
  }, [awaiting, loops])

  const closeForm = (): void => {
    setForm(null)
    setEditingId(null)
    setConfirmingId(null)
    setError(null)
  }

  const save = async (): Promise<void> => {
    if (form === null) return
    const title = form.title.trim()
    const prompt = form.prompt.trim()
    const seconds = Number(form.timeInSeconds)
    if (title.length === 0 || prompt.length === 0) {
      setError('Title and prompt are required.')
      return
    }
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      setError('Interval must be a positive whole number of seconds.')
      return
    }

    const payload = JSON.stringify({
      title,
      prompt,
      time_in_seconds: seconds,
      allow_steer: form.allowSteer,
    })
    const key = editingId ?? 'new'
    setPending(key)
    setError(null)
    try {
      const line = editingId === null ? `/loop create ${payload}` : `/loop update ${editingId} ${payload}`
      assertCommandSucceeded(await execute(line))
      const expected = { ...form, title, prompt, timeInSeconds: String(seconds) }
      setAwaiting(editingId === null
        ? { kind: 'create', expected }
        : { kind: 'update', id: editingId, expected })
    } catch (reason: unknown) {
      setError(errorText(reason))
      setPending(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setPending(id)
    setError(null)
    try {
      assertCommandSucceeded(await execute(`/loop delete ${id}`))
      setAwaiting({ kind: 'delete', id })
    } catch (reason: unknown) {
      setError(errorText(reason))
      setPending(null)
    }
  }

  return (
    <main className={css.root} aria-labelledby="claude-code-loop-title">
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>Session scoped</p>
          <h1 id="claude-code-loop-title">Loops</h1>
          <p className={css.description}>Keep a prompt recurring in this session. Edit settings any time.</p>
        </div>
        <button type="button" className={css.primaryButton} disabled={pending !== null} onClick={() => {
          setForm({ ...EMPTY_FORM })
          setEditingId(null)
          setConfirmingId(null)
          setError(null)
        }}>New loop</button>
      </header>

      {error !== null && <p className={css.error} role="alert">{error}</p>}

      {loops.length === 0 ? (
        <section className={css.empty} aria-live="polite">
          <h2>No loops yet</h2>
          <p>Create one here or use <code>/loop 60 check the build</code> in Chat.</p>
        </section>
      ) : (
        <section className={css.grid} aria-label="Active loops">
          {loops.map(loop => (
            <LoopCard
              key={loop.id}
              loop={loop}
              now={now}
              busy={pending === loop.id}
              onEdit={() => {
                setForm({
                  title: loop.title,
                  prompt: loop.prompt,
                  timeInSeconds: String(loop.time_in_seconds),
                  allowSteer: loop.allow_steer,
                })
                setEditingId(loop.id)
                setConfirmingId(null)
                setError(null)
              }}
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

      {form !== null && (
        <form className={css.form} onSubmit={event => { event.preventDefault(); void save() }}>
          <div className={css.formHeader}>
            <div>
              <p className={css.eyebrow}>{editingId === null ? 'Create loop' : 'Edit loop'}</p>
              <h2>{editingId === null ? 'New recurring prompt' : 'Adjust loop settings'}</h2>
            </div>
            <button type="button" className={css.ghostButton} onClick={closeForm} disabled={pending !== null}>Cancel</button>
          </div>
          <label>
            Title
            <input
              value={form.title}
              maxLength={80}
              placeholder="Build health"
              onChange={event => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label>
            Prompt
            <textarea
              value={form.prompt}
              rows={3}
              placeholder="Check whether the build is still healthy"
              onChange={event => setForm({ ...form, prompt: event.target.value })}
            />
          </label>
          <div className={css.formRow}>
            <label>
              Repeat every
              <span className={css.inputWithSuffix}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.timeInSeconds}
                  onChange={event => setForm({ ...form, timeInSeconds: event.target.value })}
                />
                <span>seconds</span>
              </span>
            </label>
            <label className={css.checkRow}>
              <input
                type="checkbox"
                checked={form.allowSteer}
                onChange={event => setForm({ ...form, allowSteer: event.target.checked })}
              />
              Steer a running agent
            </label>
          </div>
          <div className={css.formActions}>
            <button type="submit" className={css.primaryButton} disabled={pending !== null}>
              {pending !== null ? 'Saving…' : editingId === null ? 'Create loop' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </main>
  )
}

function LoopCard({ loop, now, busy, confirming, onEdit, onAskDelete, onCancelDelete, onDelete }: {
  loop: LoopRecord
  now: number
  busy: boolean
  confirming: boolean
  onEdit: () => void
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
          <h2>{loop.title}</h2>
          <span className={overdue || due ? css.statusDue : css.status}>
            {overdue ? 'Overdue' : due ? 'Due now' : formatNext(loop.next_at, now)}
          </span>
        </div>
        <div className={css.cardActions}>
          <button type="button" className={css.ghostButton} onClick={onEdit} disabled={busy}>Edit</button>
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
        <span>{loop.allow_steer ? 'Steer when running' : 'Follow-up'}</span>
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
  if (result.ok !== true || !isRecord(result.value) || result.value.matched !== true) {
    throw new Error('The loop command was not recognized.')
  }
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
