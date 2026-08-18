import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import { workflowRuns } from './workflow-data.ts'
import type { WorkflowDashboardInjected } from './WorkflowDashboard.tsx'
import { requestWorkflowWorkspaceOpen } from './workflow-workspace-state.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowHeaderActionProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'workflowDashboard'>
  & WorkflowDashboardInjected

function text(t: WorkflowHeaderActionProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Session-header entry point, placed beside the other session actions. */
export function WorkflowHeaderAction({ sessionId, useWorkflowSession, t }: WorkflowHeaderActionProps) {
  const runs = workflowRuns(useWorkflowSession(sessionId))
  if (runs.length === 0) return null
  const runningCount = runs.filter(run => run.data.status === 'running').length
  return (
    <button
      type="button"
      className={css.headerAction}
      aria-label={`${text(t, 'workspace.open')}: ${runs.length}`}
      onClick={requestWorkflowWorkspaceOpen}
    >
      <span className={css.headerActionIcon} aria-hidden>⌁</span>
      <span>{text(t, 'workspace.title')}</span>
      <span className={css.headerActionCount}>{runningCount > 0 ? runningCount : runs.length}</span>
    </button>
  )
}
