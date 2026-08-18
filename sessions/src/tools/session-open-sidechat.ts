import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SideChatService } from '../sidechat/sidechat-service.js'
import type { SideChatOpenArgs, SideChatResult } from '../sidechat/sidechat-types.js'

export function registerSessionOpenSidechatTool(ctx: Context, service: SideChatService): () => void {
  return ctx.tools.register(defineTool({
    name: 'session_open_sidechat',
    description: 'Open a continuable side chat that inherits the calling agent context and runs independently.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Initial side-chat prompt.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subagent_id: { type: 'string', required: true },
          message_id: { type: 'string', required: true },
          accepted: { type: 'boolean', required: true },
          status: { type: 'string', required: true, enum: ['running'] },
        },
      },
      render: (_args, value: SideChatResult) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: SideChatOpenArgs, exec): Promise<SideChatResult> {
      return service.open(args, exec.agent as Agent | undefined, exec.signal)
    },
  }))
}
