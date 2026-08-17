import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LoopsView, type LoopsViewInjected } from './LoopsView.js'

export const inject = ['slots', 'remote', 'remote.commands']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'loops',
    order: 20,
    label: () => 'Loops',
    inject: (sessionId: SessionId): LoopsViewInjected => ({
      execute: line => ctx.remote.commands.execute(sessionId, line),
    }),
  }, LoopsView))
}
