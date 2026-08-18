import { describe, expect, it } from 'vitest'
import type {
  ConversationEventInput, ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  workflowDashboardDefinition, workflowDashboardViewDefinition,
} from '../src/client/workflow-dashboard-definition.ts'
import type { WorkflowDashboardSnapshot } from '../src/client/workflow-dashboard-definition.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [workflowDashboardDefinition] }
  fallbackEntry(): undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [workflowDashboardViewDefinition] }
}

function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return {
    event: { seq, time: 1_700_000_000_000 + seq, type, data } as SessionEvent,
    view: undefined,
  }
}

function assembler(events: readonly ConversationEventInput[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(events, false)
  value.flush()
  return value
}

function dashboard(value: ConversationNodeAssembler): WorkflowDashboardSnapshot {
  const snapshot = value.snapshot('workflow-dashboard') as WorkflowDashboardSnapshot | undefined
  if (snapshot === undefined) throw new Error('dashboard view was not created')
  return snapshot
}

function completeEvents(): ConversationEventInput[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'tool-workflow/run-start', { runId: 'run-1', name: 'audit' }),
    at(4, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 1, label: 'first', phase: '', childId: 'child-1',
    }),
    at(5, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 2, label: 'second', childId: 'child-2',
    }),
    at(6, 'tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'completed' }),
    at(7, 'tool-workflow/agent-end', { runId: 'run-1', seq: 2, outcome: 'failed' }),
    at(8, 'tool-workflow/run-end', { runId: 'run-1', stopReason: 'error' }),
    at(9, 'step/end', { turn: 1, step: 1 }),
    at(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('workflow dashboard Conversation Definition', () => {
  it('replays durable runs into the dashboard-only target', () => {
    const snapshot = dashboard(assembler(completeEvents()))
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]).toMatchObject({
      kind: 'workflow-dashboard-run',
      target: 'workflow-dashboard',
      id: 'run-1',
      data: {
        name: 'audit',
        status: 'failed',
        phases: [
          { key: 'value:0:', phase: '', members: [{ status: 'completed' }] },
          { key: 'missing', phase: null, members: [{ status: 'failed' }] },
        ],
      },
    })
  })

  it('produces the same projection through live append and marks closed runs interrupted', () => {
    const events = completeEvents()
    const live = assembler(events.slice(0, 3))
    for (const event of events.slice(3)) live.append(event)
    live.flush()
    expect(dashboard(live)).toEqual(dashboard(assembler(events)))

    const interrupted = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'open', name: 'open' }),
      at(4, 'tool-workflow/agent-start', { runId: 'open', seq: 1, label: 'worker', childId: 'child-1' }),
      at(5, 'step/end', { turn: 1, step: 1 }),
    ])
    expect(dashboard(interrupted).nodes[0]?.data).toMatchObject({
      status: 'interrupted',
      phases: [{ members: [{ status: 'interrupted' }] }],
    })
  })
})
