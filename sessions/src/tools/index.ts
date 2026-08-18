import type { Context } from '@deepseek-ai/cordis'
import { SessionCreationService } from '../creation-service.js'
import { SessionsService } from '../service.js'
import { registerCreateSessionTool } from './create-session.js'
import { registerListStatusTool } from './list-status.js'
import { registerReadSessionTool } from './read-session.js'

export function registerSessionTools(
  ctx: Context,
  service: SessionsService,
  creationService?: SessionCreationService,
): () => void {
  const disposers = [
    registerListStatusTool(ctx, service),
    registerReadSessionTool(ctx, service),
    ...creationService === undefined ? [] : [registerCreateSessionTool(ctx, creationService)],
  ]

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

export { registerCreateSessionTool } from './create-session.js'
export { registerListStatusTool } from './list-status.js'
export { registerReadSessionTool } from './read-session.js'
