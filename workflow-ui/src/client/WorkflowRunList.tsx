import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import type { WorkflowRunItem } from './workflow-data.ts'
import { currentPhase, memberTotals, progressPercent, statusText } from './workflow-data.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowRunListProps = PropsLocale<'workflowDashboard'> & {
  readonly runs: readonly WorkflowRunItem[]
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
}

function text(t: WorkflowRunListProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Render the compact navigator for the current parent Session's runs. */
export function WorkflowRunList({ runs, selectedId, onSelect, t }: WorkflowRunListProps) {
  return (
    <aside className={css.runPane} aria-label={text(t, 'run.navigator')}>
      <div className={css.runPaneHeader}>
        <div>
          <span className={css.eyebrow}>{text(t, 'run.navigator')}</span>
          <h2>{text(t, 'workspace.runs')}</h2>
        </div>
        <span className={css.countPill}>{runs.length}</span>
      </div>
      <div className={css.runList}>
        {runs.length === 0
          ? <div className={css.listEmpty}><span className={css.emptyIcon}>⌁</span><p>{text(t, 'workspace.empty')}</p></div>
          : runs.map(run => {
            const totals = memberTotals(run.data)
            const phase = currentPhase(run.data)
            const percent = progressPercent(run.data)
            const status = statusText(run.data.status, t as (key: never) => string)
            return (
              <button
                type="button"
                key={run.id}
                className={css.runButton}
                data-selected={run.id === selectedId || undefined}
                data-status={run.data.status}
                onClick={() => { onSelect(run.id) }}
              >
                <span className={css.runCardTop}>
                  <span className={css.statusBadge} data-status={run.data.status}><span className={css.statusDot} aria-hidden />{status}</span>
                  {run.id === selectedId && <span className={css.selectedLabel}>Selected</span>}
                </span>
                <strong className={css.runName}>{run.data.name}</strong>
                <span className={css.runMeta}>
                  <span>{text(t, 'run.phase')}</span>
                  <span className={css.runPhase}>{phase === null || phase === '' ? text(t, 'run.noPhase') : phase}</span>
                </span>
                <span className={css.progressTrack} aria-label={`${percent}% complete`}><span className={css.progressFill} style={{ width: `${percent}%` }} /></span>
                <span className={css.runFooter}>
                  <span>{totals.completed}/{totals.total} {text(t, 'workspace.agents').toLowerCase()}</span>
                  <span>{percent}%</span>
                </span>
              </button>
            )
          })}
      </div>
    </aside>
  )
}
