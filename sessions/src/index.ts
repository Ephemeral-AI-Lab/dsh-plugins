import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { registerSessionsCommand } from './commands.js'
import { SessionCreationService } from './creation-service.js'
import { SessionsService } from './service.js'
import { registerSessionTools } from './tools/index.js'

export const name = 'dsh-sessions'
export const inject = ['tools', 'commands', 'agents', 'llm', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry']

export function apply(ctx: Context): void {
  const service = new SessionsService(ctx)
  const creationService = new SessionCreationService(ctx)
  const disposeTool = registerSessionTools(ctx, service, creationService)
  const disposeCommand = registerSessionsCommand(ctx, service, creationService)

  ctx.effect(() => async () => {
    disposeCommand()
    disposeTool()
    await creationService.dispose()
  }, 'dsh-sessions cleanup')
}

export { registerSessionsCommand, parseSessionsCommand } from './commands.js'
export { SessionCreationService } from './creation-service.js'
export { READ_SESSION_LIMIT, SessionsService, parseReadSessionArgs, validateLimit } from './service.js'
export { registerSessionTools, registerSessionTools as registerSessionsTool } from './tools/index.js'
export * from './types.js'
