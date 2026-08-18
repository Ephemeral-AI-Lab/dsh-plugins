import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  CheckSessionStatusArgs,
  ListSessionsArgs,
  ReadSessionArgs,
  ReadSessionResult,
  SessionStatus,
  CheckedSessionStatus,
} from './types.js'
import { formatReadSessionOutput } from './read-format.js'
import { READ_SESSION_LIMIT, SessionsService, parseReadSessionArgs, validateLimit } from './service.js'

const SESSION_STATUS: readonly SessionStatus[] = ['running', 'idle', 'cold']
const CHECKED_SESSION_STATUS: readonly CheckedSessionStatus[] = [...SESSION_STATUS, 'missing']

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

const READ_SESSION_MESSAGE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const

export function registerSessionsTool(ctx: Context, service: SessionsService): () => void {
  const disposers = [ctx.tools.register(defineTool({
    name: 'list_sessions',
    description: 'List live and cold sessions without resuming or changing them.',
    parameters: {
      limit: {
        type: 'number',
        description: 'Optional positive maximum number of sessions to return.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessions: { type: 'array', required: true, items: SESSION_VIEW_SCHEMA },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: ListSessionsArgs, exec) {
      validateLimit(args.limit)
      return service.listSessions(args, exec.signal)
    },
  })), ctx.tools.register(defineTool({
    name: 'read_session',
    description: 'Read a bounded window of reconstructed message blocks from one session without resuming or changing it. Trace events, token deltas, and lifecycle records are omitted.',
    parameters: {
      session_id: {
        type: 'string',
        required: true,
        description: 'Exact session ID to read.',
      },
      offset: {
        type: 'number',
        description: '1-based first message-block offset. Defaults to 1.',
      },
      limit: {
        type: 'number',
        description: `Maximum number of message blocks to return. Defaults to ${READ_SESSION_LIMIT}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session_id: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          messages: { type: 'array', required: true, items: READ_SESSION_MESSAGE_SCHEMA },
          total_messages: { type: 'integer', required: true },
        },
      },
      render: (_args, value: ReadSessionResult) => [{ type: 'text', text: formatReadSessionOutput(value) }],
    },
    async execute(args: ReadSessionArgs, exec) {
      parseReadSessionArgs(args)
      return service.readSession(args, exec.signal)
    },
  })), ctx.tools.register(defineTool({
    name: 'check_session_status',
    description: 'Check one session without resuming or changing it.',
    parameters: {
      session_id: {
        type: 'string',
        required: true,
        description: 'Exact session ID to inspect.',
      },
    },
    output: {
      schema: SESSION_STATUS_VIEW_SCHEMA,
      render: (_args, value) => renderJson(value),
    },
    async execute(args: CheckSessionStatusArgs, exec) {
      return service.checkSessionStatus(args, exec.signal)
    },
  }))]

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

function renderJson(value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}
