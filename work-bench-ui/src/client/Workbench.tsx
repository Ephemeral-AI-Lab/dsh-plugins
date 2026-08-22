import { useSyncExternalStore } from 'react'
import { IconDownloadOutline16, IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchService } from './registry.js'
import css from './Workbench.module.css'

type SessionExport = {
  download: (sessionId: SessionId) => Promise<void>
}

export type WorkbenchHeaderActionProps = PropsRuntime<'conversation.session.header.utilities'> & {
  workbench: WorkbenchService
}

export type ExportHeaderActionProps = PropsRuntime<'conversation.session.header.utilities'> & {
  sessionExport: SessionExport
}

export type WorkbenchSurfaceProps = PropsRuntime<'details'> & {
  workbench: WorkbenchService
}

export function WorkbenchHeaderAction({ workbench }: WorkbenchHeaderActionProps) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot)
  return (
    <button
      type="button"
      className={css.headerButton}
      aria-label={snapshot.open ? 'Close Workbench' : 'Open Workbench'}
      title="Workbench"
      aria-pressed={snapshot.open}
      data-open={snapshot.open || undefined}
      onClick={() => { workbench.toggle() }}
    >
      <IconPanelLeftOutline16 size={16} />
    </button>
  )
}

export function ExportHeaderAction({ sessionId, sessionExport }: ExportHeaderActionProps) {
  return (
    <button
      type="button"
      className={css.headerButton}
      aria-label="Export session"
      title="Export session"
      onClick={() => { void sessionExport.download(sessionId) }}
    >
      <IconDownloadOutline16 size={16} />
    </button>
  )
}

export function WorkbenchPanel({ workbench }: WorkbenchSurfaceProps) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot)
  const first = snapshot.items[0]
  const active = snapshot.items.find(item => item.id === snapshot.activeId) ?? first
  if (!snapshot.open) return null
  const Active = active?.component

  return (
    <section className={css.panel} aria-label="Workbench">
      <header className={css.header}>
        <div>
          <h2>Workbench</h2>
          <span>{snapshot.items.length} tool{snapshot.items.length === 1 ? '' : 's'}</span>
        </div>
        <button type="button" className={css.close} aria-label="Close Workbench" onClick={() => { workbench.close() }}>×</button>
      </header>
      {active !== undefined && <div className={css.tabs} role="tablist" aria-label="Workbench tools">
        {snapshot.items.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === active.id}
            className={item.id === active.id ? `${css.tab} ${css.activeTab}` : css.tab}
            onClick={() => { workbench.open(item.id) }}
          >
            {item.icon !== undefined && <span className={css.icon} aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ))}
      </div>}
      <section className={css.body} role="tabpanel" aria-label={active?.label ?? 'Workbench'}>
        {Active === undefined ? <p className={css.empty}>No tools registered yet.</p> : <Active close={() => { workbench.close() }} />}
      </section>
    </section>
  )
}
