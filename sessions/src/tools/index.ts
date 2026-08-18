import type { Context } from '@deepseek-ai/cordis'
import { SessionCreationService } from '../creation-service.js'
import { SessionSendService } from '../send-service.js'
import { SessionsService } from '../service.js'
import { registerSessionCreateTool } from './session-create.js'
import { registerSessionStatusTool } from './session-status.js'
import { registerSessionReadTool } from './session-read.js'
import { registerSessionSendTool } from './session-send.js'

export function registerSessionTools(
  ctx: Context,
  service: SessionsService,
  creationService?: SessionCreationService,
  sendService?: SessionSendService,
): () => void {
  const disposers = [
    registerSessionStatusTool(ctx, service),
    registerSessionReadTool(ctx, service),
    ...creationService === undefined ? [] : [registerSessionCreateTool(ctx, creationService)],
    ...sendService === undefined ? [] : [registerSessionSendTool(ctx, sendService)],
  ]

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

export { registerSessionCreateTool } from './session-create.js'
export { registerSessionStatusTool } from './session-status.js'
export { registerSessionReadTool } from './session-read.js'
export { registerSessionSendTool } from './session-send.js'
