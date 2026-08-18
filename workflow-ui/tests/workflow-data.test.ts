import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { workflowRuns } from '../src/client/workflow-data.ts'

function snapshotWithToolResult(text: string, isError = false): ConversationSnapshot {
  return {
    views: {
      get: () => ({
        nodes: [{
          key: 'run', kind: 'workflow-dashboard-run', id: 'run-1', target: 'workflow-dashboard', anchorSeq: 3,
          data: { name: 'audit', status: isError ? 'failed' : 'completed', phases: [] },
        }],
      }),
    },
    chat: {
      nodes: {
        values: () => [{
          key: 'tool', kind: 'tool-call', id: 'call-1', target: 'chat', anchorSeq: 4,
          data: {
            root: {
              kind: 'tool-result',
              content: [{ type: 'text', text }],
              isError,
              error: isError ? { name: 'WorkflowError', code: 'failed' } : undefined,
            },
          },
        }],
      },
    },
  } as unknown as ConversationSnapshot
}

describe('workflow data projection', () => {
  it('reads structured workflow results from the typed tool projection', () => {
    const runs = workflowRuns(snapshotWithToolResult('Return value:\n{\n  "missingAuth": 3\n}'))
    expect(runs[0]?.data.result).toEqual({ missingAuth: 3 })
  })

  it('surfaces typed tool errors without inspecting raw model messages', () => {
    const runs = workflowRuns(snapshotWithToolResult('workflow run failed: denied', true))
    expect(runs[0]?.data.error).toBe('WorkflowError: failed')
  })
})
