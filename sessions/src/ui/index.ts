import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle, HistoryEntry, SubagentListEntry } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import { SessionsPopupController } from './controller.js'
import { SessionsResultPopup, type SessionsResultPopupInjected } from './SessionsResultPopup.js'
import { sessionReadToolview } from './SessionReadRow.js'
import { isSideChatResult } from '../sidechat/sidechat-types.js'
import { SideChatPanel, type SideChatPanelInjected } from './sidechat/SideChatPanel.js'
import type { SideChatConversationSnapshot } from '../sidechat/sidechat-types.js'
import type { SideChatMessage } from '../sidechat/sidechat-types.js'
import { SideChatStore } from './sidechat/sidechat-store.js'

export const inject = ['slots', 'sessions', 'connection', 'remote', 'remote.commands']

export function apply(ctx: ClientContext): void {
  const sideChats = new SideChatStore()
  ctx.inject(['slots', 'sessions', 'connection', 'remote', 'remote.commands'], (scope: ClientContext) => {
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
      if (commandName !== 'sessions') return
      const sideChat = parseSideChatResult(result)
      if (sideChat !== undefined) {
        sideChats.open(String(sessionId), sideChat)
        return
      }
      controllerFor(sessionId).show(result)
    })

    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay',
      id: 'sessions-sidechat-panel',
      order: 20,
      inject: (): SideChatPanelInjected => ({
        store: sideChats,
        sendMessage: async (mainSessionId, subagentId, message) => {
          const result = await scope.remote.commands.execute(
            mainSessionId as SessionId,
            `/sessions sidechat-send ${subagentId} ${message}`,
            [],
          )
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          if (result.value === undefined || result.value.result.kind === 'error') {
            throw new Error(result.value?.result.text ?? 'side-chat continuation was not accepted')
          }
          sideChats.settle(mainSessionId, subagentId, 'running', 'live')
        },
        loadConversation: async (mainSessionId, subagentId) => {
          const response = await (scope.get('connection') as ConnectionHandle).api.subagents.history({
            parentSessionId: mainSessionId as SessionId,
            childSessionId: subagentId as SessionId,
            mode: 'continuable',
            maxMessages: 100,
          })
          if (!response.result.ok) {
            return {
              messages: [],
              status: 'error',
              residency: 'cold',
              canContinue: true,
            } satisfies SideChatConversationSnapshot
          }
          return {
            messages: sideChatMessages(response.result.value.events),
            ...sideChatState(response.result.value.events, subagentActivity(scope, mainSessionId, subagentId)),
          }
        },
      }),
    }, SideChatPanel))

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

function subagentActivity(
  scope: ClientContext,
  mainSessionId: string,
  subagentId: string,
): 'running' | 'inactive' | undefined {
  const catalog = scope.sessions.list.getSnapshot()
    .subagentsByParent[mainSessionId as SessionId] as unknown as {
      readonly entries?: readonly SubagentListEntry[]
  } | undefined
  const entries = catalog?.entries ?? []
  return entries.find((entry): entry is Extract<SubagentListEntry, { kind: 'child' }> =>
    entry.kind === 'child' && entry.id === subagentId)?.activity
}

function parseSideChatResult(result: CommandResult) {
  if (result.kind !== 'success' || result.text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(result.text)
    return isSideChatResult(value) ? value : undefined
  } catch {
    return undefined
  }
}

function sideChatMessages(events: readonly HistoryEntry[]): readonly SideChatMessage[] {
  const messages: SideChatMessage[] = []
  for (const entry of events) {
    const event = entry.event
    if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'tool/result') continue
    const message = event.type === 'user/message' ? event.data : event.data.message
    messages.push({
      id: String(message.id ?? event.seq),
      role: event.type === 'user/message' ? 'user' : event.type === 'tool/result' ? 'tool' : 'assistant',
      text: contentText(message.content),
    })
  }
  return messages
}

function sideChatState(
  events: readonly HistoryEntry[],
  activity: 'running' | 'inactive' | undefined,
): Pick<SideChatConversationSnapshot, 'status' | 'residency' | 'canContinue'> {
  const ending = [...events].reverse().find(entry => entry.event.type === 'turn/end')?.event
  if (ending?.type !== 'turn/end') {
    return { status: 'running', residency: activity === 'running' ? 'live' : 'cold', canContinue: true }
  }
  const reason = ending.data.reason
  const status = reason.kind === 'error'
    ? 'error'
    : reason.kind === 'aborted' && reason.reason.kind === 'parent'
      ? 'finished'
      : activity === 'running' ? 'idle' : 'finished'
  return { status, residency: activity === 'running' ? 'live' : 'cold', canContinue: true }
}

function contentText(content: readonly unknown[]): string {
  return content.map(block => {
    if (typeof block !== 'object' || block === null) return String(block)
    const record = block as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (record.type === 'tool-call' && typeof record.name === 'string') return `[${record.name}]`
    return `[${String(record.type ?? 'content')}]`
  }).join('')
}

export { SessionsPopupController } from './controller.js'
export type { SessionPopupRow, SessionsPopupState } from './controller.js'
export { SessionsResultPopup } from './SessionsResultPopup.js'
export type { SessionsResultPopupInjected, SessionsResultPopupProps } from './SessionsResultPopup.js'
