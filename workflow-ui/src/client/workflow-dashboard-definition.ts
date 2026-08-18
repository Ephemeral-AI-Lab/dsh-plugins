import type {
  ConversationLocation, ConversationNodeContext,
  ConversationNodeDefinition, ConversationViewBuilder, ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  ToolWorkflowAgentEndData, ToolWorkflowAgentStartData, ToolWorkflowRunEndData,
} from '@deepseek-ai/dsh-tool-workflow/types'
import type { WorkflowAgentOutcome, WorkflowStopReason } from '@deepseek-ai/dsh-workflow/types'
import type {
  WorkflowRunChatData, WorkflowRunMemberData, WorkflowRunStatus,
} from './workflow-data.ts'

const TARGET = 'workflow-dashboard'

interface WorkflowRunStartData {
  readonly runId: string
  readonly name: string
}

interface WorkflowMemberState extends Omit<ToolWorkflowAgentStartData, 'runId'> {
  readonly outcome?: WorkflowAgentOutcome
}

interface WorkflowState {
  readonly name: string
  readonly stopReason?: WorkflowStopReason
  readonly members: readonly WorkflowMemberState[]
}

export interface WorkflowDashboardViewNode extends ConversationViewNode {
  readonly kind: 'workflow-dashboard-run'
  readonly target: typeof TARGET
  readonly anchorSeq: number
  readonly data: WorkflowRunChatData
}

export interface WorkflowDashboardSnapshot {
  readonly nodes: readonly WorkflowDashboardViewNode[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationViewSnapshotMap {
    'workflow-dashboard': WorkflowDashboardSnapshot
  }
}

export function workflowPhaseKey(phase: string | null): string {
  return phase === null ? 'missing' : `value:${phase.length}:${phase}`
}

function statusFromStopReason(stopReason: WorkflowStopReason): WorkflowRunStatus {
  switch (stopReason) {
    case 'completed': return 'completed'
    case 'cancelled': return 'cancelled'
    case 'error': return 'failed'
    default: return stopReason satisfies never
  }
}

function statusFromOutcome(outcome: WorkflowAgentOutcome): WorkflowRunStatus {
  switch (outcome) {
    case 'completed': return 'completed'
    case 'cancelled': return 'cancelled'
    case 'failed': return 'failed'
    default: return outcome satisfies never
  }
}

function locationClosed(location: ConversationLocation): boolean {
  if (location.kind === 'step') {
    return location.step.status === 'closed' || location.turn.status === 'closed'
  }
  return location.kind === 'turn' && location.turn.status === 'closed'
}

function projectWorkflow(
  context: ConversationNodeContext<WorkflowState>,
  location: ConversationLocation,
): WorkflowRunChatData {
  const state = context.state as WorkflowState
  const interrupted = state.stopReason === undefined && locationClosed(location)
  const phases = new Map<string, { phase: string | null; members: WorkflowRunMemberData[] }>()
  for (const member of state.members) {
    const phase = member.phase === undefined ? null : member.phase
    const key = workflowPhaseKey(phase)
    let group = phases.get(key)
    if (group === undefined) {
      group = { phase, members: [] }
      phases.set(key, group)
    }
    group.members.push({
      seq: member.seq,
      label: member.label,
      childId: member.childId,
      status: member.outcome === undefined
        ? interrupted ? 'interrupted' : 'running'
        : statusFromOutcome(member.outcome),
    })
  }
  return {
    name: state.name,
    status: state.stopReason === undefined
      ? interrupted ? 'interrupted' : 'running'
      : statusFromStopReason(state.stopReason),
    phases: [...phases].map(([key, phase]) => ({
      key,
      phase: phase.phase,
      members: phase.members,
    })),
  }
}

function updateAgentStart(state: WorkflowState, data: ToolWorkflowAgentStartData): WorkflowState {
  return {
    ...state,
    members: [...state.members, {
      seq: data.seq,
      label: data.label,
      ...data.phase === undefined ? {} : { phase: data.phase },
      childId: data.childId,
    }],
  }
}

function updateAgentEnd(state: WorkflowState, data: ToolWorkflowAgentEndData): WorkflowState {
  return {
    ...state,
    members: state.members.map(member => member.seq === data.seq
      ? { ...member, outcome: data.outcome }
      : member),
  }
}

function isWorkflowEvent(event: SessionEvent): event is SessionEvent & {
  readonly data: WorkflowRunStartData | ToolWorkflowAgentStartData | ToolWorkflowAgentEndData | ToolWorkflowRunEndData
} {
  return event.type === 'tool-workflow/run-start'
    || event.type === 'tool-workflow/agent-start'
    || event.type === 'tool-workflow/agent-end'
    || event.type === 'tool-workflow/run-end'
}

/** Project the existing durable workflow record into a dashboard-only view target. */
export const workflowDashboardDefinition: ConversationNodeDefinition<WorkflowState> = {
  kind: 'workflow-dashboard-run',
  target: TARGET,
  match: (event) => {
    if (!isWorkflowEvent(event)) return null
    return event.type === 'tool-workflow/run-start'
      ? { id: String(event.data.runId), role: 'start' }
      : { id: String(event.data.runId), role: 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool-workflow/run-start') {
      throw new Error('workflow-dashboard-run start requires tool-workflow/run-start')
    }
    return { name: match.event.data.name, members: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool-workflow/agent-start') return updateAgentStart(context.state, match.event.data)
    if (match.event.type === 'tool-workflow/agent-end') return updateAgentEnd(context.state, match.event.data)
    if (match.event.type === 'tool-workflow/run-end') {
      return { ...context.state, stopReason: match.event.data.stopReason }
    }
    return context.state
  },
  buildViewNode: (context): WorkflowDashboardViewNode | null => {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'workflow-dashboard-run',
      id: context.id,
      target: TARGET,
      anchorSeq: context.start.event.seq,
      data: projectWorkflow(context, context.start.location),
    }
  },
}

/** Small immutable builder used by each Session's dashboard view. */
export const workflowDashboardViewDefinition: ConversationViewDefinition<
  WorkflowDashboardViewNode, WorkflowDashboardSnapshot
> = {
  target: TARGET,
  create: () => {
    let nodes = new Map<string, WorkflowDashboardViewNode>()
    const snapshot = (): WorkflowDashboardSnapshot => ({
      nodes: [...nodes.values()].sort((left, right) => left.anchorSeq - right.anchorSeq),
    })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

export type WorkflowDashboardViewBuilder = ConversationViewBuilder<
  WorkflowDashboardViewNode, WorkflowDashboardSnapshot
>
