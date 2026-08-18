import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ReadSessionArgs, ReadSessionResult } from '../types.js'
import { formatReadSessionOutput } from '../read-format.js'
import { READ_SESSION_LIMIT, SessionsService, parseReadSessionArgs } from '../service.js'

const READ_SESSION_MESSAGE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const

export function registerSessionReadTool(ctx: Context, service: SessionsService): () => void {
  return ctx.tools.register(defineTool({
    name: 'session_read',
    description: 'Read a bounded window of reconstructed message blocks from one session without resuming or changing it. Trace events, token deltas, and lifecycle records are omitted.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Exact session ID to read.' },
      offset: { type: 'number', description: '1-based first message-block offset. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of message blocks to return. Defaults to ${READ_SESSION_LIMIT}.` },
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
  }))
}
