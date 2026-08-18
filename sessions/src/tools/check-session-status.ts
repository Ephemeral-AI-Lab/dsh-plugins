import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CheckSessionStatusArgs, CheckedSessionStatus, SessionStatus } from '../types.js'
import { SessionsService } from '../service.js'

const SESSION_STATUS: readonly SessionStatus[] = ['running', 'idle', 'cold']
const CHECKED_SESSION_STATUS: readonly CheckedSessionStatus[] = [...SESSION_STATUS, 'missing']

const SESSION_STATUS_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true },
    title: { type: 'string' },
    status: { type: 'string', required: true, enum: [...CHECKED_SESSION_STATUS] },
    updated_at: { type: 'string' },
  },
} as const

export function registerCheckSessionStatusTool(ctx: Context, service: SessionsService): () => void {
  return ctx.tools.register(defineTool({
    name: 'check_session_status',
    description: 'Check one session without resuming or changing it.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Exact session ID to inspect.' },
    },
    output: {
      schema: SESSION_STATUS_VIEW_SCHEMA,
      render: (_args, value) => renderJson(value),
    },
    async execute(args: CheckSessionStatusArgs, exec) {
      return service.checkSessionStatus(args, exec.signal)
    },
  }))
}

function renderJson(value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}
