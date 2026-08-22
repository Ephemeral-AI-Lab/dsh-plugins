import { createElement, type ComponentType } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkbenchPanelProps, WorkbenchService } from 'dsh-workbench-ui/client'
import { SideChatPanel } from './SideChatPanel.js'
import { SideChatClient, SideChatStore } from './store.js'

import type {} from 'dsh-workbench-ui/client'

export const inject = ['workbench', 'sessions', 'connection']

export function apply(ctx: ClientContext): void {
  const workbench = ctx.get('workbench') as WorkbenchService
  const sessions = ctx.get('sessions') as unknown as ISessions
  const connection = ctx.get('connection') as ConnectionHandle
  const store = new SideChatStore(new SideChatClient(connection.rpc))
  const component: ComponentType<WorkbenchPanelProps> = props =>
    createElement(SideChatPanel, { ...props, store, sessions })

  ctx.effect(() => workbench.register({
    id: 'sidechat',
    label: 'Side chat',
    component,
    order: 0,
  }), 'sidechat: Workbench panel')
  ctx.effect(() => () => store.dispose(), 'sidechat: client memory')
}

export { SideChatPanel } from './SideChatPanel.js'
export { SideChatClient, SideChatStore } from './store.js'
