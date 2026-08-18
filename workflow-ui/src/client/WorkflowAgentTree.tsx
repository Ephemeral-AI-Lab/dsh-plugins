import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import { canOpenMember, memberStatusText, phaseStatus, statusText } from './workflow-data.ts'
import type { WorkflowRunMemberData, WorkflowRunPhaseData } from './workflow-data.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowAgentTreeProps = PropsLocale<'workflowDashboard'> & {
  readonly phases: readonly WorkflowRunPhaseData[]
  readonly sessions: SessionListState
  readonly parentId: SessionId
  readonly selectedSeq: number | undefined
  readonly onSelectMember: (member: WorkflowRunMemberData) => void
  readonly openSession: (id: SessionId) => void
}

function text(t: WorkflowAgentTreeProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

function Member({ member, props }: { member: WorkflowRunMemberData; props: WorkflowAgentTreeProps }) {
  const label = member.label === '' ? 'Unnamed member' : member.label
  const navigable = canOpenMember(props.sessions, props.parentId, member)
  const selected = props.selectedSeq === member.seq
  return (
    <div className={css.memberRow} data-selected={selected || undefined}>
      <button
        type="button"
        className={css.memberSelectButton}
        onClick={() => { props.onSelectMember(member) }}
        aria-label={`${label} · ${memberStatusText(member.status, props.t as (key: never) => string)}`}
        aria-pressed={selected}
      >
        <span className={css.memberConnector} aria-hidden>└</span>
        <span className={css.statusDot} data-status={member.status} aria-hidden />
        <span className={css.memberName}>{label}</span>
        <span className={css.memberStatus}>{memberStatusText(member.status, props.t as (key: never) => string)}</span>
      </button>
      {navigable && (
        <button
          type="button"
          className={css.memberOpenButton}
          onClick={() => { props.openSession(member.childId) }}
          aria-label={text(props.t, 'detail.child')}
          title={text(props.t, 'detail.child')}
        >↗</button>
      )}
    </div>
  )
}

/** Render phase sections and their child-session member rows. */
export function WorkflowAgentTree(props: WorkflowAgentTreeProps) {
  if (props.phases.length === 0) return <p className={css.muted}>{text(props.t, 'detail.noPhase')}</p>
  return (
    <div className={css.phaseStack}>
      {props.phases.map(phase => {
        const status = phaseStatus(phase)
        const label = phase.phase === null || phase.phase === '' ? text(props.t, 'run.noPhase') : phase.phase
        return (
          <section key={phase.key} className={css.phaseSection} data-status={status}>
            <div className={css.phaseHeader}>
              <span className={css.phaseRail} aria-hidden />
              <div className={css.phaseTitleBlock}>
                <h4>{label}</h4>
                <span>{phase.members.length} {text(props.t, 'detail.members').replace('{count}', '').trim()}</span>
              </div>
              <span className={css.phaseStatus} data-status={status}><span className={css.statusDot} aria-hidden />{statusText(status, props.t as (key: never) => string)}</span>
            </div>
            {phase.members.length === 0
              ? <p className={css.muted}>{text(props.t, 'run.noMembers')}</p>
              : <div className={css.memberStack}>{phase.members.map(member => <Member key={member.seq} member={member} props={props} />)}</div>}
          </section>
        )
      })}
    </div>
  )
}
