import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowDashboardKey } from './locales.ts'
import css from './WorkflowDashboard.module.css'

export type WorkflowLogProps = PropsLocale<'workflowDashboard'> & { readonly logs: readonly string[] }

function text(t: WorkflowLogProps['t'], key: WorkflowDashboardKey): string {
  return t(key as never)
}

/** Render the ordered durable workflow narration lines. */
export function WorkflowLog({ logs, t }: WorkflowLogProps) {
  return logs.length === 0
    ? <div className={css.logEmpty}><span className={css.emptyIcon}>◌</span><p>{text(t, 'detail.noLogs')}</p></div>
    : <ol className={css.logList}>{logs.map((message, index) => <li key={`${index}:${message}`}><span className={css.logIndex}>{String(index + 1).padStart(2, '0')}</span><span>{message}</span></li>)}</ol>
}
