import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import { SessionsPopupController } from './controller.js'
import { SessionsResultPopup, type SessionsResultPopupInjected } from './SessionsResultPopup.js'
import { sessionReadToolview } from './SessionReadRow.js'

export const inject = ['slots', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.inject(['slots', 'sessions'], (scope: ClientContext) => {
    sessionReadToolview.apply(scope)
    const controllers = new Map<SessionId, SessionsPopupController>()
    const controllerFor = (sessionId: SessionId): SessionsPopupController => {
      let controller = controllers.get(sessionId)
      if (controller === undefined) {
        controller = new SessionsPopupController()
        controllers.set(sessionId, controller)
      }
      return controller
    }

    scope.on('command/executed', (sessionId: SessionId, commandName: string, result: CommandResult) => {
      if (commandName === 'sessions') controllerFor(sessionId).show(result)
    })

    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay',
      id: 'sessions-result-popup',
      order: 2,
      inject: (sessionId: SessionId): SessionsResultPopupInjected => ({
        controller: controllerFor(sessionId),
        open: (targetSessionId) => { scope.sessions.open(targetSessionId) },
      }),
    }, SessionsResultPopup))

    // /sessions is a control-plane command: its result belongs to the
    // transient popup, not to the durable conversation transcript. The host
    // lifecycle remains persisted for command auditing, but this keyed row
    // renderer keeps it out of the chat surface, including after reload.
    scope.slots.inject('conversation.chat.commandview', () => scope.slots.register({
      name: 'conversation.chat.commandview',
      key: 'sessions',
    }, () => null))
  })
}

export { SessionsPopupController } from './controller.js'
export type { SessionPopupRow, SessionsPopupState } from './controller.js'
export { SessionsResultPopup } from './SessionsResultPopup.js'
export type { SessionsResultPopupInjected, SessionsResultPopupProps } from './SessionsResultPopup.js'
