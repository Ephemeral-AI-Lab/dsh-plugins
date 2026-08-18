import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkflowWorkspace } from './WorkflowWorkspace.tsx'
import type { WorkflowDashboardInjected } from './WorkflowDashboard.tsx'

export type WorkflowViewProps = PropsRuntime<'conversation.view'>
  & PropsLocale<'workflowDashboard'>
  & WorkflowDashboardInjected

/** Native conversation view tab for workflow inspection. */
export function WorkflowView({ sessionId, useSessions, useWorkflowSession, warmWorkflowSession, openSession, t }: WorkflowViewProps) {
  const sessions = useSessions(state => state)
  return (
    <WorkflowWorkspace
      sessionId={sessionId}
      sessions={sessions}
      snapshot={useWorkflowSession(sessionId)}
      useWorkflowSession={useWorkflowSession}
      warmWorkflowSession={warmWorkflowSession}
      openSession={openSession}
      embedded
      t={t}
    />
  )
}
