import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import { registerSessionsCommand } from './commands.js'
import { SessionsService } from './service.js'
import { registerSessionsTool } from './tools.js'

export const name = 'dsh-sessions'
export const inject = ['tools', 'commands', 'agents', 'sessionPersistence', 'sessionQuery']

export function apply(ctx: Context): void {
  const service = new SessionsService(ctx)
  const disposeTool = registerSessionsTool(ctx, service)
  const disposeCommand = registerSessionsCommand(ctx, service)

  ctx.effect(() => () => {
    disposeCommand()
    disposeTool()
  }, 'dsh-sessions cleanup')
}

export { registerSessionsCommand, parseSessionsCommand } from './commands.js'
export { READ_SESSION_LIMIT, SessionsService, parseReadSessionArgs, validateLimit } from './service.js'
export { registerSessionsTool } from './tools.js'
export * from './types.js'
