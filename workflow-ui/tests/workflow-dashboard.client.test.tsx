// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationSnapshot, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { WorkflowDashboard, type WorkflowDashboardProps } from '../src/client/WorkflowDashboard.tsx'
import { WorkflowAgentMessages } from '../src/client/WorkflowAgentMessages.tsx'
import { WorkflowRunDetail } from '../src/client/WorkflowRunDetail.tsx'
import { WorkflowHeaderAction, type WorkflowHeaderActionProps } from '../src/client/WorkflowHeaderAction.tsx'
import type { WorkflowRunChatData, WorkflowRunMemberData } from '../src/client/workflow-data.ts'

afterEach(cleanup)

const PARENT = 'parent' as SessionId
const CHILD = 'child' as SessionId
const CHILD_B = 'child-b' as SessionId

function sessions(): SessionListState {
  return {
    ids: [PARENT, CHILD, CHILD_B],
    byId: {
      [PARENT]: { id: PARENT, displayTitle: 'Parent', running: true, blank: false, updatedAt: 0 },
      [CHILD]: {
        id: CHILD, displayTitle: 'Child', parentId: PARENT, origin: 'subagent',
        running: false, blank: false, updatedAt: 0,
      },
      [CHILD_B]: {
        id: CHILD_B, displayTitle: 'Child B', parentId: PARENT, origin: 'subagent',
        running: false, blank: false, updatedAt: 0,
      },
    },
    current: PARENT,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function snapshot(data: WorkflowRunChatData): ConversationSnapshot {
  return snapshotMany([{ id: 'run-1', data }])
}

function snapshotMany(runs: readonly { id: string; data: WorkflowRunChatData }[]): ConversationSnapshot {
  return {
    views: {
      get: (target: string) => target === 'workflow-dashboard'
        ? { nodes: runs.map(run => ({ key: run.id, kind: 'workflow-dashboard-run', id: run.id, target, data: run.data })) }
        : undefined,
    },
  } as unknown as ConversationSnapshot
}

function props(
  data: WorkflowRunChatData,
  openSession = vi.fn(),
  customSnapshot: ConversationSnapshot | undefined = undefined,
): WorkflowDashboardProps {
  const state = sessions()
  const useSessions = (<T,>(selector: (value: SessionListState) => T): T => selector(state)) as WorkflowDashboardProps['useSessions']
  const t = ((key: string) => {
    const copy: Record<string, string> = {
      'workspace.title': 'Workflows',
      'workspace.eyebrow': 'Session workspace',
      'workspace.open': 'Open workflows',
      'workspace.close': 'Close workflows',
      'workspace.empty': 'No workflow runs.',
      'workspace.emptyHint': 'Start a workflow in this Session to see its live progress here.',
      'workspace.noMatches': 'No runs match this filter.',
      'workspace.loading': 'Loading workflow history…',
      'workspace.runs': 'Runs',
      'workspace.agents': 'Agents',
      'filter.all': 'All',
      'filter.running': 'Running',
      'filter.failed': 'Failed',
      'run.navigator': 'Run navigator',
      'run.phase': 'Current phase',
      'run.noMembers': 'No agents.',
      'run.noPhase': 'Unassigned',
      'detail.phases': 'Phases',
      'detail.entries': 'entries',
      'detail.loadingMessages': 'Loading full message history…',
      'detail.noMessages': 'No messages recorded for this agent yet.',
      'detail.messageStream': 'Scrollable agent message stream',
      'detail.unnamedAgent': 'Unnamed agent',
      'detail.child': 'Open child Session',
      'detail.logs': 'Logs',
      'detail.result': 'Result',
      'detail.error': 'Error',
      'detail.overview': 'Run overview',
      'detail.members': '{count} members',
      'detail.noPhase': 'No phases recorded yet.',
      'detail.interruptedHint': 'The Session ended before this workflow emitted a terminal event.',
      'detail.cancelledHint': 'This workflow was cancelled before all members completed.',
      'detail.noLogs': 'No log messages.',
      'detail.noResult': 'No structured result.',
      'status.running': 'Running',
      'status.completed': 'Completed',
      'status.failed': 'Failed',
      'status.cancelled': 'Cancelled',
      'status.interrupted': 'Interrupted',
      'member.running': 'Running',
      'member.completed': 'Completed',
      'member.failed': 'Failed',
      'member.cancelled': 'Cancelled',
      'member.interrupted': 'Interrupted',
      'message.assistant': 'Agent',
      'message.reasoning': 'Reasoning',
      'message.tool': 'Tool',
      'message.user': 'Prompt',
    }
    return copy[key] ?? key
  }) as WorkflowDashboardProps['t']
  return {
    useSessions,
    useWorkflowSession: () => customSnapshot ?? snapshot(data),
    openSession,
    t,
  }
}

function openOverlay(): void {
  const launcher = screen.queryByRole('button', { name: 'Open workflows', exact: true })
  if (launcher !== null) fireEvent.click(launcher)
}

describe('WorkflowDashboard', () => {
  it('shows the run navigator, agent detail, logs, and result', () => {
    render(<WorkflowDashboard {...props({
      name: 'audit', status: 'completed',
      phases: [{ key: 'phase', phase: 'Research', members: [{ seq: 1, label: 'worker', childId: CHILD, status: 'completed' }] }],
      logs: ['started', 'finished'], result: { ok: true },
    })} />)
    openOverlay()

    expect(screen.getByRole('heading', { name: 'audit' })).toBeTruthy()
    expect(screen.getAllByText('Research').length).toBeGreaterThan(0)
    expect(screen.getByText('started')).toBeTruthy()
    expect(screen.getByText(/"ok": true/)).toBeTruthy()
  })

  it('opens a child Session for a navigable workflow member', () => {
    const openSession = vi.fn()
    render(<WorkflowDashboard {...props({
      name: 'audit', status: 'running',
      phases: [{ key: 'phase', phase: null, members: [{ seq: 1, label: 'worker', childId: CHILD, status: 'running' }] }],
    }, openSession)} />)
    openOverlay()

    fireEvent.click(screen.getByRole('button', { name: 'Open child Session' }))
    expect(openSession).toHaveBeenCalledWith(CHILD)
  })

  it('gives the selected run a status badge, phase summary, and progress meter', () => {
    render(<WorkflowDashboard {...props({
      name: 'audit', status: 'failed',
      phases: [{ key: 'phase', phase: 'Review', members: [
        { seq: 1, label: 'worker-a', childId: CHILD, status: 'completed' },
        { seq: 2, label: 'worker-b', childId: CHILD, status: 'failed' },
      ] }],
    })} />)
    openOverlay()

    expect(screen.getByRole('article').getAttribute('data-run-status')).toBe('failed')
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Review').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('50% complete').length).toBe(2)
    expect(screen.getByText('Selected')).toBeTruthy()
  })

  it('filters the navigator without changing the workspace shell', () => {
    const active: WorkflowRunChatData = { name: 'active', status: 'running', phases: [] }
    const done: WorkflowRunChatData = { name: 'done', status: 'completed', phases: [] }
    const multi = snapshotMany([{ id: 'active', data: active }, { id: 'done', data: done }])
    render(<WorkflowDashboard {...props(active, vi.fn(), multi)} />)
    openOverlay()

    expect(screen.getByRole('button', { name: /active/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /done/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Failed/i }))
    expect(screen.queryByRole('button', { name: /active/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /done/i })).toBeNull()
    expect(screen.getByText('No runs match this filter.')).toBeTruthy()
  })

  it('keeps an actionable empty state when the Session has no workflow runs', () => {
    render(<WorkflowDashboard {...props({ name: 'unused', status: 'completed', phases: [] }, vi.fn(), {
      views: { get: () => ({ nodes: [] }) },
    } as unknown as ConversationSnapshot)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open workflows' }))
    expect(screen.getAllByText('No workflow runs.').length).toBeGreaterThan(0)
  })

  it('adds a session-header workflow action that opens the workspace', () => {
    const data: WorkflowRunChatData = { name: 'audit', status: 'completed', phases: [] }
    const dashboardProps = props(data)
    const emptySnapshot = { views: { get: () => ({ nodes: [] }) } } as unknown as ConversationSnapshot
    const headerProps: WorkflowHeaderActionProps = {
      sessionId: PARENT,
      useWorkflowSession: () => snapshot(data),
      openSession: vi.fn(),
      t: dashboardProps.t,
    }

    render(<>
      <WorkflowHeaderAction {...headerProps} />
      <WorkflowDashboard {...dashboardProps} useWorkflowSession={() => emptySnapshot} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: /Open workflows: 1/i }))
    expect(screen.getByRole('region', { name: 'Workflows' })).toBeTruthy()
  })

  it('renders a bounded, switchable message stream for child Sessions', () => {
    const member: WorkflowRunMemberData = { seq: 1, label: 'worker-a', childId: CHILD, status: 'running' }
    const childSnapshot = (text: string): ConversationSnapshot => ({
      chat: { nodes: { values: () => [{ key: 'assistant-1', kind: 'assistant-step', data: {
        status: 'settled', blocks: [{ kind: 'text', text }],
      } }] } },
    } as unknown as ConversationSnapshot)
    const useWorkflowSession = vi.fn(() => childSnapshot('Scanning the repository…'))
    const warmWorkflowSession = vi.fn()

    render(<WorkflowAgentMessages member={member} useWorkflowSession={useWorkflowSession} warmWorkflowSession={warmWorkflowSession} t={props({ name: 'unused', status: 'completed', phases: [] }).t} />)

    expect(screen.getByTestId('agent-messages')).toBeTruthy()
    expect(screen.getByText('worker-a')).toBeTruthy()
    expect(screen.getByRole('log', { name: 'Scrollable agent message stream' })).toBeTruthy()
    expect(screen.getByText('Scanning the repository…')).toBeTruthy()
    expect(useWorkflowSession).toHaveBeenCalledWith(CHILD)
    expect(warmWorkflowSession).toHaveBeenCalledWith(CHILD)
  })

  it('selects an agent row to update its message preview without navigating away', () => {
    const childSnapshot = (text: string): ConversationSnapshot => ({
      chat: { nodes: { values: () => [{ key: 'assistant-1', kind: 'assistant-step', data: {
        status: 'settled', blocks: [{ kind: 'text', text }],
      } }] } },
    } as unknown as ConversationSnapshot)
    const useWorkflowSession = vi.fn((sessionId: SessionId | undefined) => sessionId === CHILD
      ? childSnapshot('Worker A is checking the files.')
      : childSnapshot('Worker B is preparing the report.'))
    const warmWorkflowSession = vi.fn()
    const openSession = vi.fn()
    const run = {
      id: 'run-1',
      data: {
        name: 'audit', status: 'running' as const, phases: [{ key: 'phase', phase: 'Review', members: [
          { seq: 1, label: 'worker-a', childId: CHILD, status: 'running' as const },
          { seq: 2, label: 'worker-b', childId: CHILD_B, status: 'completed' as const },
        ] }],
      },
    }

    render(<WorkflowRunDetail
      run={run}
      sessions={sessions()}
      parentId={PARENT}
      useWorkflowSession={useWorkflowSession}
      warmWorkflowSession={warmWorkflowSession}
      openSession={openSession}
      t={props({ name: 'unused', status: 'completed', phases: [] }).t}
    />)

    expect(screen.getByText('Worker A is checking the files.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /worker-b/i }))
    expect(screen.getByText('Worker B is preparing the report.')).toBeTruthy()
    expect(openSession).not.toHaveBeenCalled()
    expect(warmWorkflowSession).toHaveBeenCalledWith(CHILD_B)
  })
})
