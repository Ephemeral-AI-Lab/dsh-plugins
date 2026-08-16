import type { Context } from '@deepseek-ai/cordis'
import { SessionCommunicationService } from './session-communication.js'
import { registerSessionCommunicationTools } from './tools.js'

export const name = 'codex-session-communication'
export const inject = ['tools', 'agents', 'sessionPersistence']

export function apply(ctx: Context): void {
  const service = new SessionCommunicationService(ctx)
  const unregisterTools = registerSessionCommunicationTools(ctx, service)

  ctx.effect(() => async () => {
    unregisterTools()
    await service.dispose()
  }, 'codex-session-communication cleanup')
}

export { SessionCommunicationService } from './session-communication.js'
