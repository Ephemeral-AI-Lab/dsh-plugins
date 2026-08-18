import { useEffect, useState } from 'react'
import type { ConversationSnapshot, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import { WorkflowRunDetail } from './WorkflowRunDetail.tsx'
import { WorkflowRunList } from './WorkflowRunList.tsx'
import { memberTotals, workflowRuns, type WorkflowRunItem } from './workflow-data.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowWorkspaceProps = PropsLocale<'workflowDashboard'> & {
  readonly sessionId: SessionId | undefined
  readonly sessions: SessionListState
  readonly snapshot: ConversationSnapshot | undefined
  readonly useWorkflowSession: (sessionId: SessionId | undefined) => ConversationSnapshot | undefined
  readonly warmWorkflowSession: ((sessionId: SessionId) => void) | undefined
  readonly openSession: (sessionId: SessionId) => void
  readonly embedded?: boolean
  readonly onClose?: () => void
}

type Filter = 'all' | 'running' | 'failed'

function filteredRuns(runs: readonly WorkflowRunItem[], filter: Filter): readonly WorkflowRunItem[] {
  if (filter === 'all') return runs
  return runs.filter(run => filter === 'failed'
    ? run.data.status === 'failed'
    : run.data.status === 'running')
}

function text(t: WorkflowWorkspaceProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Shared workflow surface used by the shell overlay and the native Workflow tab. */
export function WorkflowWorkspace({
  sessionId, sessions, snapshot, useWorkflowSession, warmWorkflowSession, openSession, embedded = false, onClose, t,
}: WorkflowWorkspaceProps) {
  const runs = workflowRuns(snapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>(() => runs[0]?.id)
  const visible = filteredRuns(runs, filter)
  const selected = visible.find(run => run.id === selectedId) ?? visible[0]
  const loading = sessionId !== undefined && snapshot === undefined

  useEffect(() => {
    if (selected?.id !== selectedId) setSelectedId(selected?.id)
  }, [selected?.id, selectedId])

  const runningCount = runs.filter(run => run.data.status === 'running').length
  const totalMembers = runs.reduce((sum, run) => sum + memberTotals(run.data).total, 0)
  const label = runningCount > 0 ? `${text(t, 'workspace.title')} (${runningCount})` : text(t, 'workspace.title')

  return (
    <section className={css.workspace} data-embedded={embedded || undefined} aria-label={text(t, 'workspace.title')}>
      <header className={css.workspaceHeader}>
        <div className={css.brandBlock}>
          <span className={css.eyebrow}>{text(t, 'workspace.eyebrow')}</span>
          <div className={css.titleLine}>
            <h1>{label}</h1>
            {runningCount > 0 && <span className={css.activePill}>{runningCount} active</span>}
          </div>
          <p>{sessionId ?? 'No Session'} <span aria-hidden>·</span> {totalMembers} {text(t, 'workspace.agents').toLowerCase()}</p>
        </div>
        <div className={css.headerActions}>
          <div className={css.headerStats} aria-label="Workflow totals">
            <span><strong>{runs.length}</strong><small>{text(t, 'workspace.runs')}</small></span>
            <span><strong>{runningCount}</strong><small>{text(t, 'filter.running')}</small></span>
          </div>
          {!embedded && onClose !== undefined && (
            <button type="button" className={css.closeButton} onClick={onClose} aria-label={text(t, 'workspace.close')}>×</button>
          )}
        </div>
      </header>
      <nav className={css.filters} aria-label="Workflow filters">
        <span className={css.filterLabel}>View</span>
        {(['all', 'running', 'failed'] as const).map(value => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            data-active={filter === value || undefined}
            onClick={() => { setFilter(value) }}
          >
            {text(t, `filter.${value}` as WorkflowDashboardKey)}
            {value === 'all' && <span className={css.filterCount}>{runs.length}</span>}
            {value === 'running' && <span className={css.filterCount}>{runningCount}</span>}
            {value === 'failed' && <span className={css.filterCount}>{runs.filter(run => run.data.status === 'failed').length}</span>}
          </button>
        ))}
      </nav>
      {loading
        ? <div className={css.emptyWorkspace} data-empty-state="loading"><span className={css.emptyIcon}>◌</span><h2>{text(t, 'workspace.loading')}</h2></div>
        : <div className={css.panes}>
          <WorkflowRunList runs={visible} selectedId={selected?.id} onSelect={setSelectedId} t={t} />
          {visible.length === 0 && runs.length > 0
            ? <div className={css.emptyDetail} data-testid="empty-filter-state" data-empty-state="filter"><span className={css.emptyIcon}>⌁</span><h2>{text(t, 'workspace.noMatches')}</h2><p>{text(t, 'workspace.emptyHint')}</p></div>
            : sessionId === undefined || runs.length === 0
              ? <div className={css.emptyDetail} data-empty-state="empty"><span className={css.emptyIcon}>⌁</span><h2>{text(t, 'workspace.empty')}</h2><p>{text(t, 'workspace.emptyHint')}</p></div>
              : <WorkflowRunDetail run={selected} sessions={sessions} parentId={sessionId} useWorkflowSession={useWorkflowSession} warmWorkflowSession={warmWorkflowSession} openSession={openSession} t={t} />}
        </div>}
    </section>
  )
}
