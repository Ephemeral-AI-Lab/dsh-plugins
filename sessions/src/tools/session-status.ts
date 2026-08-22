import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ListStatusArgs, ListStatusResult, SessionStatus } from '../types.js'
import { SessionsService } from '../service.js'

const SESSION_STATUS: readonly (SessionStatus | 'missing')[] = ['running', 'idle', 'cold', 'missing']
const SESSION_STATUS_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true },
    title: { type: 'string' },
    status: { type: 'string', required: true, enum: [...SESSION_STATUS] },
    updated_at: { type: 'string' },
    session_path: { type: 'string' },
  },
} as const

export function registerSessionStatusTool(ctx: Context, service: SessionsService): () => void {
  return ctx.tools.register(defineTool({
    name: 'session_status',
    description: 'List recent sessions or check one exact session without resuming or changing it.',
    parameters: {
      session_id: { type: 'string', description: 'Optional exact session ID to inspect.' },
      recent_n: { type: 'number', default: 50, description: 'Optional positive number of recent sessions to return. Defaults to 50.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { sessions: { type: 'array', required: true, items: SESSION_STATUS_VIEW_SCHEMA } },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: ListStatusArgs, exec): Promise<ListStatusResult> {
      return service.listStatus(args, exec.signal)
    },
  }))
}

function renderJson(value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}
