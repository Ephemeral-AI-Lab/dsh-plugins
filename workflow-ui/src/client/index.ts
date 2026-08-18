/** Browser plugin for the native DHS workflow workspace. */
import { useMemo, useSyncExternalStore } from 'react'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workflow-run/client'
import { WorkflowDashboard, type WorkflowDashboardInjected } from './WorkflowDashboard.tsx'
import { WorkflowHeaderAction } from './WorkflowHeaderAction.tsx'
import { WorkflowView } from './WorkflowView.tsx'
import { en, NS, type WorkflowDashboardKey, zh } from './locales.ts'
import { workflowDashboardDefinition, workflowDashboardViewDefinition } from './workflow-dashboard-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workflow workspace copy. */
    workflowDashboard: WorkflowDashboardKey
  }
}

/** Services required by the dashboard Definition/slot and Session navigation. */
export const inject = ['conversationEvents', 'conversationViews', 'slots', 'sessions', 'locale']

const EMPTY_SESSION: ObservableSnapshot<ConversationSnapshot | undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Warm an existing child Session without changing the current selection.
 * The public SessionFace intentionally exposes reads and navigation verbs;
 * the concrete client Session also has an idempotent history opener. Keep the
 * adapter narrow and optional so the plugin remains compatible with fixtures
 * and older runtimes while avoiding a redirect for message inspection.
 */
async function warmWorkflowSession(ctx: ClientContext, sessionId: SessionId): Promise<void> {
  const session = ctx.sessions.binding(sessionId)?.session
  const open = (session as unknown as { open?: () => Promise<void> } | undefined)?.open
  if (session === undefined || open === undefined) return
  await open.call(session)
  for (let page = 0; page < 128; page += 1) {
    const snapshot = session.getSnapshot()
    if (!snapshot.hasMore || snapshot.loadingOlder) return
    await session.loadOlder()
  }
}

/** Build a stable hook over the current Session's Conversation snapshot. */
function useWorkflowSession(ctx: ClientContext, sessionId: SessionId | undefined): ConversationSnapshot | undefined {
  const session = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)?.session
  const source = useMemo<ObservableSnapshot<ConversationSnapshot | undefined>>(() => {
    if (session === undefined) return EMPTY_SESSION
    // SessionFace exposes methods whose implementation reads its own private
    // notifier. React stores the callbacks and invokes them without the face
    // as `this`, so bind the observable methods at the adapter boundary.
    return {
      getSnapshot: session.getSnapshot.bind(session),
      subscribe: session.subscribe.bind(session),
    }
  }, [session])
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}

/** Register the locale namespace and the additive root workspace overlay. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(workflowDashboardDefinition)
  ctx.conversationViews.register(workflowDashboardViewDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workflow-ui: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workflow-ui',
    locale: NS,
    inject: (): WorkflowDashboardInjected => ({
      useWorkflowSession: (sessionId) => useWorkflowSession(ctx, sessionId),
      warmWorkflowSession: (sessionId) => { warmWorkflowSession(ctx, sessionId) },
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    }),
  }, WorkflowDashboard))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'workflow-ui',
    order: 30,
    locale: NS,
    inject: (): WorkflowDashboardInjected => ({
      useWorkflowSession: (sessionId) => useWorkflowSession(ctx, sessionId),
      warmWorkflowSession: (sessionId) => { warmWorkflowSession(ctx, sessionId) },
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    }),
  }, WorkflowHeaderAction))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'workflow',
    order: 20,
    locale: NS,
    label: () => t('view.workflow'),
    inject: (): WorkflowDashboardInjected => ({
      useWorkflowSession: (sessionId) => useWorkflowSession(ctx, sessionId),
      warmWorkflowSession: (sessionId) => { warmWorkflowSession(ctx, sessionId) },
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    }),
  }, WorkflowView))
}
