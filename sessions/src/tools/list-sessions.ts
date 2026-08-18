import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ListSessionsArgs, SessionStatus } from '../types.js'
import { SessionsService, validateLimit } from '../service.js'

const SESSION_STATUS: readonly SessionStatus[] = ['running', 'idle', 'cold']
const SESSION_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true },
    title: { type: 'string' },
    status: { type: 'string', required: true, enum: [...SESSION_STATUS] },
    updated_at: { type: 'string', required: true },
  },
} as const

export function registerListSessionsTool(ctx: Context, service: SessionsService): () => void {
  return ctx.tools.register(defineTool({
    name: 'list_sessions',
    description: 'List live and cold sessions without resuming or changing them.',
    parameters: {
      limit: { type: 'number', description: 'Optional positive maximum number of sessions to return.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { sessions: { type: 'array', required: true, items: SESSION_VIEW_SCHEMA } },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: ListSessionsArgs, exec) {
      validateLimit(args.limit)
      return service.listSessions(args, exec.signal)
    },
  }))
}

function renderJson(value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}
