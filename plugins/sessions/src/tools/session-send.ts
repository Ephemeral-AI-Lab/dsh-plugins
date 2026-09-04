import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionSendService } from '../send-service.js'
import type { SessionSendArgs, SessionSendResult } from '../types.js'

export function registerSessionSendTool(ctx: Context, service: SessionSendService): () => void {
  return ctx.tools.register(defineTool({
    name: 'session_send',
    description: 'Send a text message to an existing session. Defaults to steering the nearest step; followup queues a separate next turn.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session ID returned by session_status or session_create.' },
      message: { type: 'string', required: true, description: 'Text message to send.' },
      mode: {
        type: 'string',
        enum: ['steer', 'followup'],
        default: 'steer',
        description: 'Delivery mode. steer wakes idle agents and targets the nearest step; followup queues a separate next turn.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { message_id: { type: 'string', required: true } },
      },
      render: (_args, value: SessionSendResult) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: SessionSendArgs, exec): Promise<SessionSendResult> {
      return service.send(args, exec.agent as Agent | undefined, exec.signal)
    },
  }))
}
