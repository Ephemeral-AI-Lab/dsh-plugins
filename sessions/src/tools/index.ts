import type { Context } from '@deepseek-ai/cordis'
import { SessionCreationService } from '../creation-service.js'
import { SessionsService } from '../service.js'
import { registerCheckSessionStatusTool } from './check-session-status.js'
import { registerCreateSessionTool } from './create-session.js'
import { registerListSessionsTool } from './list-sessions.js'
import { registerReadSessionTool } from './read-session.js'

export function registerSessionTools(
  ctx: Context,
  service: SessionsService,
  creationService?: SessionCreationService,
): () => void {
  const disposers = [
    registerListSessionsTool(ctx, service),
    registerReadSessionTool(ctx, service),
    registerCheckSessionStatusTool(ctx, service),
    ...creationService === undefined ? [] : [registerCreateSessionTool(ctx, creationService)],
  ]

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

export { registerCheckSessionStatusTool } from './check-session-status.js'
export { registerCreateSessionTool } from './create-session.js'
export { registerListSessionsTool } from './list-sessions.js'
export { registerReadSessionTool } from './read-session.js'
