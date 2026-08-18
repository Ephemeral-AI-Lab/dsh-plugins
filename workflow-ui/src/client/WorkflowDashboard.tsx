import { useEffect, useState } from 'react'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import { WorkflowWorkspace } from './WorkflowWorkspace.tsx'
import type { WorkflowWorkspaceProps } from './WorkflowWorkspace.tsx'
import { workflowRuns } from './workflow-data.ts'
import { useWorkflowWorkspaceRequest } from './workflow-workspace-state.ts'
import css from './WorkflowDashboard.module.css'

export interface WorkflowDashboardInjected {
  readonly useWorkflowSession: (sessionId: SessionId | undefined) => ConversationSnapshot | undefined
  readonly warmWorkflowSession?: (sessionId: SessionId) => void
  readonly openSession: (sessionId: SessionId) => void
}

export type WorkflowDashboardProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'workflowDashboard'>
  & WorkflowDashboardInjected

function text(t: WorkflowDashboardProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Root-scoped launcher and shared workflow workspace overlay. */
export function WorkflowDashboard({
  useSessions, useWorkflowSession, warmWorkflowSession, openSession, t,
}: WorkflowDashboardProps) {
  const sessionId = useSessions(state => state.current)
  const sessions = useSessions(state => state)
  const snapshot = useWorkflowSession(sessionId)
  const runs = workflowRuns(snapshot)
  const [open, setOpen] = useState(false)
  const openRequest = useWorkflowWorkspaceRequest()

  useEffect(() => {
    if (openRequest > 0) setOpen(true)
  }, [openRequest])

  const runningCount = runs.filter(run => run.data.status === 'running').length
  const label = runningCount > 0 ? `${text(t, 'workspace.title')} (${runningCount})` : text(t, 'workspace.title')

  return (
    <div className={css.host} data-workflow-dashboard>
      {!open && (
        <button type="button" className={css.launcher} onClick={() => { setOpen(true) }} aria-label={text(t, 'workspace.open')}>
          <span className={css.launcherIcon} aria-hidden>⌁</span>
          <span>{label}</span>
          {runningCount > 0 && <span className={css.launcherCount}>{runningCount}</span>}
        </button>
      )}
      {open && (
        <WorkflowWorkspace
          sessionId={sessionId}
          sessions={sessions}
          snapshot={snapshot}
          useWorkflowSession={useWorkflowSession}
          warmWorkflowSession={warmWorkflowSession}
          openSession={openSession}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </div>
  )
}

export type { WorkflowWorkspaceProps }
