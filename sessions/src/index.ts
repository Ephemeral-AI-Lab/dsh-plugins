import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { registerSessionsCommand } from './commands.js'
import { SessionCreationService } from './creation-service.js'
import { SessionSendService } from './send-service.js'
import { SessionsService } from './service.js'
import { registerSessionTools } from './tools/index.js'
import { SideChatService } from './sidechat/sidechat-service.js'

export const name = 'dsh-sessions'
export const inject = ['tools', 'commands', 'agents', 'subagents', 'llm', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry']

export function apply(ctx: Context): void {
  const service = new SessionsService(ctx)
  const creationService = new SessionCreationService(ctx)
  const sendService = new SessionSendService(ctx)
  const sideChatService = new SideChatService(ctx)
  const disposeTool = registerSessionTools(ctx, service, creationService, sendService, sideChatService)
  const disposeCommand = registerSessionsCommand(ctx, service, creationService, sendService, sideChatService)

  ctx.effect(() => async () => {
    disposeCommand()
    disposeTool()
    await sendService.dispose()
    await creationService.dispose()
  }, 'dsh-sessions cleanup')
}

export { registerSessionsCommand, parseSessionsCommand } from './commands.js'
export { parseSideChatArgs } from './commands.js'
export { SessionCreationService } from './creation-service.js'
export { SessionSendService } from './send-service.js'
export { LIST_STATUS_DEFAULT_RECENT_N, READ_SESSION_LIMIT, SessionsService, parseReadSessionArgs, validateRecentN } from './service.js'
export { registerSessionTools, registerSessionTools as registerSessionsTool } from './tools/index.js'
export { SideChatService } from './sidechat/sidechat-service.js'
export type * from './sidechat/sidechat-types.js'
export * from './types.js'
