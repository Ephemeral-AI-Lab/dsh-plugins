import type {
  ChatConversationViewNode, ConversationSnapshot, SessionId, SessionListState, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolChatData } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkflowDashboardSnapshot } from './workflow-dashboard-definition.ts'

/** Status shared by the durable workflow record and its browser projection. */
export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface WorkflowRunMemberData {
  readonly seq: number
  readonly label: string
  readonly childId: SessionId
  readonly status: WorkflowRunStatus
}

export interface WorkflowRunPhaseData {
  readonly key: string
  readonly phase: string | null
  readonly members: readonly WorkflowRunMemberData[]
}

/** Browser-owned projection payload; optional fields are future-compatible UI data. */
export interface WorkflowRunChatData {
  readonly name: string
  readonly status: WorkflowRunStatus
  readonly phases: readonly WorkflowRunPhaseData[]
  readonly logs?: readonly string[]
  readonly result?: unknown
  readonly error?: string
}

export interface WorkflowRunItem {
  readonly id: string
  readonly data: WorkflowRunChatData
}

function isToolNode(node: ChatConversationViewNode): node is ChatConversationViewNode & {
  readonly data: ToolChatData
} {
  return node.kind === 'tool-call' && node.data !== null && typeof node.data === 'object'
    && 'root' in node.data
}

function isSettledTool(
  block: ToolCallBlock,
): block is Extract<ToolCallBlock, { readonly kind: 'tool-result' }> {
  return 'kind' in block && block.kind === 'tool-result'
}

function resultText(data: ToolChatData): string | undefined {
  if (!isSettledTool(data.root)) return undefined
  return data.root.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function isWorkflowResult(data: ToolChatData): boolean {
  if (!isSettledTool(data.root)) return false
  const text = resultText(data)
  return data.root.call?.name === 'workflow'
    || text?.includes('Return value:\n') === true
    || text?.includes('workflow run') === true
}

function resultForRun(
  snapshot: ConversationSnapshot,
  startSeq: number,
  nextStartSeq: number | undefined,
): { readonly result?: unknown; readonly error?: string } | undefined {
  const chat = snapshot.chat
  if (chat === undefined) return undefined
  const candidate = chat.nodes.values()
    .filter(isToolNode)
    .filter(node => node.anchorSeq >= startSeq
      && (nextStartSeq === undefined || node.anchorSeq < nextStartSeq))
    .map(node => node.data)
    .find(isWorkflowResult)
  if (candidate === undefined || !isSettledTool(candidate.root)) return undefined
  const text = resultText(candidate)
  const marker = 'Return value:\n'
  const markerIndex = text?.indexOf(marker) ?? -1
  if (markerIndex >= 0) {
    const rendered = text?.slice(markerIndex + marker.length).trim()
    if (rendered !== undefined) {
      try {
        return { result: JSON.parse(rendered) as unknown }
      } catch {
        return { error: rendered }
      }
    }
  }
  if (candidate.root.isError) {
    const detail = candidate.root.error === undefined
      ? text
      : `${candidate.root.error.name}: ${candidate.root.error.code}`
    return { error: detail ?? 'Workflow tool failed.' }
  }
  return undefined
}

function enrichRunData(
  snapshot: ConversationSnapshot,
  data: WorkflowRunChatData,
  startSeq: number,
  nextStartSeq: number | undefined,
): WorkflowRunChatData {
  const result = resultForRun(snapshot, startSeq, nextStartSeq)
  return result === undefined ? data : { ...data, ...result }
}

function isWorkflowNode(node: ChatConversationViewNode): node is ChatConversationViewNode & {
  readonly data: WorkflowRunChatData
} {
  return node.kind === 'workflow-run' && node.data !== null && typeof node.data === 'object'
}

/** Read the plugin-owned projection, with the inline node as a compatibility fallback. */
export function workflowRuns(snapshot: ConversationSnapshot | undefined): readonly WorkflowRunItem[] {
  if (snapshot === undefined) return []
  const dashboard = snapshot.views.get('workflow-dashboard') as WorkflowDashboardSnapshot | undefined
  if (dashboard !== undefined) {
    return dashboard.nodes.map((node, index) => ({
      id: node.id,
      data: enrichRunData(snapshot, node.data, node.anchorSeq, dashboard.nodes[index + 1]?.anchorSeq),
    }))
  }
  return snapshot.chat.nodes.values()
    .filter(isWorkflowNode)
    .map(node => ({ id: node.id, data: node.data }))
}

export function memberTotals(data: WorkflowRunChatData): { completed: number; total: number } {
  const members = data.phases.flatMap(phase => phase.members)
  return {
    completed: members.filter(member => member.status === 'completed').length,
    total: members.length,
  }
}

export function currentPhase(data: WorkflowRunChatData): string | null {
  const active = data.phases.find(phase => phase.members.some(member => member.status === 'running'))
  if (active !== undefined) return active.phase
  return data.phases.at(-1)?.phase ?? null
}

export function phaseStatus(phase: WorkflowRunPhaseData): WorkflowRunStatus {
  if (phase.members.some(member => member.status === 'failed')) return 'failed'
  if (phase.members.some(member => member.status === 'running')) return 'running'
  if (phase.members.some(member => member.status === 'interrupted')) return 'interrupted'
  if (phase.members.some(member => member.status === 'cancelled')) return 'cancelled'
  return 'completed'
}

export function progressPercent(data: WorkflowRunChatData): number {
  const { completed, total } = memberTotals(data)
  if (total === 0) return data.status === 'completed' ? 100 : 0
  return Math.round((completed / total) * 100)
}

export function statusText(status: WorkflowRunStatus, t: (key: never) => string): string {
  return t(`status.${status}` as never)
}

export function memberStatusText(status: WorkflowRunStatus, t: (key: never) => string): string {
  return t(`member.${status}` as never)
}

/** Only ordinary, parent-owned catalog rows can be navigated through SessionRuntime. */
export function canOpenMember(
  sessions: SessionListState,
  parentId: SessionId,
  member: WorkflowRunMemberData,
): boolean {
  const summary = sessions.byId[member.childId]
  return sessions.ids.includes(member.childId)
    && summary?.origin === 'subagent'
    && summary.parentId === parentId
}
