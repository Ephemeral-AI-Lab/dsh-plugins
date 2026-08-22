import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
import { ExportHeaderAction, WorkbenchHeaderAction, WorkbenchPanel } from './Workbench.js'
import { WorkbenchRegistry } from './registry.js'

export type {
  WorkbenchItem, WorkbenchPanelProps, WorkbenchRegistryOptions, WorkbenchService, WorkbenchSnapshot,
} from './registry.js'
export { WorkbenchRegistry } from './registry.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workbench: import('./registry.js').WorkbenchService
  }
}

export const inject = ['slots', 'layout', 'sessionLogDownload']

export function apply(ctx: ClientContext): void {
  const layout = ctx.get('layout') as ILayout
  const sessionExport = ctx.get('sessionLogDownload') as { download: (sessionId: SessionId) => Promise<void> }
  const workbench = new WorkbenchRegistry({
    onOpen: () => { layout.openDetails() },
    onClose: () => { layout.closeDetails() },
  })
  ctx.provide('workbench', workbench)
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    order: 0,
    priority: -100,
    inject: () => ({ sessionExport }),
  }, ExportHeaderAction))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench',
    order: 10,
    inject: () => ({ workbench }),
  }, WorkbenchHeaderAction))
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    // The host ships one details occupant. Lowest priority intentionally makes
    // Workbench the active details-column surface for this profile.
    priority: -100,
    inject: (_sessionId) => ({ workbench }),
  }, WorkbenchPanel))
}
