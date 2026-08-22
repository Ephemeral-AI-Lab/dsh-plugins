import type { Context } from '@deepseek-ai/cordis'
import { SessionCreationService } from '../creation-service.js'
import { SessionSendService } from '../send-service.js'
import { SessionsService } from '../service.js'
import { registerSessionCreateTool } from './session-create.js'
import { registerSessionSendTool } from './session-send.js'
import { registerSessionStatusTool } from './session-status.js'

export function registerSessionTools(
  ctx: Context,
  service: SessionsService,
  creationService?: SessionCreationService,
  sendService?: SessionSendService,
): () => void {
  const disposers = [
    registerSessionStatusTool(ctx, service),
    ...creationService === undefined ? [] : [registerSessionCreateTool(ctx, creationService)],
    ...sendService === undefined ? [] : [registerSessionSendTool(ctx, sendService)],
  ]

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

export { registerSessionCreateTool } from './session-create.js'
export { registerSessionSendTool } from './session-send.js'
export { registerSessionStatusTool } from './session-status.js'
