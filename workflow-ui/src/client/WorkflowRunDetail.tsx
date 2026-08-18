import { useEffect, useState } from 'react'
import type { ConversationSnapshot, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import { WorkflowAgentTree } from './WorkflowAgentTree.tsx'
import { WorkflowAgentMessages } from './WorkflowAgentMessages.tsx'
import { WorkflowLog } from './WorkflowLog.tsx'
import type { WorkflowRunItem } from './workflow-data.ts'
import { currentPhase, memberTotals, progressPercent, statusText } from './workflow-data.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowRunDetailProps = PropsLocale<'workflowDashboard'> & {
  readonly run: WorkflowRunItem | undefined
  readonly sessions: SessionListState
  readonly parentId: SessionId
  readonly useWorkflowSession: (sessionId: SessionId | undefined) => ConversationSnapshot | undefined
  readonly warmWorkflowSession: ((sessionId: SessionId) => void) | undefined
  readonly openSession: (id: SessionId) => void
}

function formatResult(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value)
}

function text(t: WorkflowRunDetailProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Render the selected run's phases, members, logs, result, and terminal error. */
export function WorkflowRunDetail({ run, sessions, parentId, useWorkflowSession, warmWorkflowSession, openSession, t }: WorkflowRunDetailProps) {
  const members = run?.data.phases.flatMap(current => current.members) ?? []
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>(() => members[0]?.seq)
  const selectedMember = members.find(member => member.seq === selectedSeq) ?? members[0]

  useEffect(() => {
    if (selectedMember?.seq !== selectedSeq) setSelectedSeq(selectedMember?.seq)
  }, [selectedMember?.seq, selectedSeq])

  if (run === undefined) return <p className={css.muted}>{text(t, 'workspace.empty')}</p>
  const totals = memberTotals(run.data)
  const percent = progressPercent(run.data)
  const phase = currentPhase(run.data)
  const status = statusText(run.data.status, t as (key: never) => string)

  return (
    <article className={css.detail} data-run-id={run.id} data-run-status={run.data.status}>
      <header className={css.detailHeader}>
        <div className={css.detailTitleBlock}>
          <span className={css.eyebrow}>{text(t, 'detail.overview')}</span>
          <h2>{run.data.name}</h2>
          <p>{phase === null || phase === '' ? text(t, 'run.noPhase') : phase} <span aria-hidden>·</span> {totals.completed}/{totals.total} {text(t, 'workspace.agents').toLowerCase()}</p>
        </div>
        <span className={css.statusBadge} data-status={run.data.status}><span className={css.statusDot} aria-hidden />{status}</span>
      </header>
      <div className={css.detailProgress}>
        <div className={css.progressTrack} aria-label={`${percent}% complete`}><span className={css.progressFill} style={{ width: `${percent}%` }} /></div>
        <span>{percent}%</span>
      </div>
      {(run.data.status === 'interrupted' || run.data.status === 'cancelled') && (
        <div className={css.stateNotice} data-status={run.data.status}>
          <span className={css.noticeIcon} aria-hidden>!</span>
          <span>{text(t, run.data.status === 'interrupted' ? 'detail.interruptedHint' : 'detail.cancelledHint')}</span>
        </div>
      )}
      <section className={css.detailSection}>
        <div className={css.sectionHeader}>
          <h3>{text(t, 'detail.phases')}</h3>
          <span>{run.data.phases.length} phases</span>
        </div>
        <WorkflowAgentTree phases={run.data.phases} sessions={sessions} parentId={parentId} selectedSeq={selectedSeq} onSelectMember={member => { setSelectedSeq(member.seq) }} openSession={openSession} t={t} />
      </section>
      <WorkflowAgentMessages member={selectedMember} useWorkflowSession={useWorkflowSession} warmWorkflowSession={warmWorkflowSession} t={t} />
      <section className={css.detailSection}>
        <div className={css.sectionHeader}>
          <h3>{text(t, 'detail.logs')}</h3>
          <span>{run.data.logs?.length ?? 0} entries</span>
        </div>
        <WorkflowLog logs={run.data.logs ?? []} t={t} />
      </section>
      {run.data.result !== undefined && (
        <section className={css.detailSection}>
          <div className={css.sectionHeader}><h3>{text(t, 'detail.result')}</h3><span>JSON</span></div>
          <pre className={css.code}>{formatResult(run.data.result)}</pre>
        </section>
      )}
      {run.data.result === undefined && run.data.status === 'completed' && (
        <section className={css.detailSection}>
          <div className={css.sectionHeader}><h3>{text(t, 'detail.result')}</h3></div>
          <p className={css.muted}>{text(t, 'detail.noResult')}</p>
        </section>
      )}
      {run.data.error !== undefined && (
        <section className={css.detailSection} data-error>
          <div className={css.sectionHeader}><h3>{text(t, 'detail.error')}</h3></div>
          <pre className={css.error}>{run.data.error}</pre>
        </section>
      )}
    </article>
  )
}
