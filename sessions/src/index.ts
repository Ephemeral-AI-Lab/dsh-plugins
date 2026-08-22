import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { SessionCreationService } from './creation-service.js'
import { SessionSendService } from './send-service.js'
import { SessionsService } from './service.js'
import { registerSessionTools } from './tools/index.js'

export const name = 'dsh-sessions'
export const inject = ['tools', 'agents', 'llm', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry']

export function apply(ctx: Context): void {
  const service = new SessionsService(ctx)
  const creationService = new SessionCreationService(ctx)
  const sendService = new SessionSendService(ctx)
  const disposeTool = registerSessionTools(ctx, service, creationService, sendService)

  ctx.effect(() => async () => {
    disposeTool()
    await sendService.dispose()
    await creationService.dispose()
  }, 'dsh-sessions cleanup')
}

export { SessionCreationService } from './creation-service.js'
export { SessionSendService } from './send-service.js'
export { LIST_STATUS_DEFAULT_RECENT_N, SessionsService, validateRecentN } from './service.js'
export { registerSessionTools, registerSessionTools as registerSessionsTool } from './tools/index.js'
export * from './types.js'
