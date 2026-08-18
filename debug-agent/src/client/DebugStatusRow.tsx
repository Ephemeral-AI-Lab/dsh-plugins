import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DebugUiState } from '../types.js'
import type { DebugAgentKey } from './locales.js'
import css from './DebugStatusRow.module.css'

export type DebugStatusRowProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'debugAgent'>

interface StatusProps {
  readonly state: DebugUiState | null | undefined
  readonly t: (key: DebugAgentKey, params?: Record<string, string | number>) => string
}

function labelFor(state: DebugUiState, t: StatusProps['t']): string {
  return t(state.mode === 'replay' ? 'replay.label' : 'run.label')
}

export function statusTextFor(state: DebugUiState, t: StatusProps['t']): string {
  const label = labelFor(state, t)
  switch (state.phase) {
    case 'queued': return t('status.queued', { label })
    case 'running': return t('status.running', { label })
    case 'waiting': return t('status.waiting', { label })
    case 'failed': return t('status.failed', { label })
    case 'completed': return t('status.completed', { label })
    case 'cancelled': return t('status.cancelled', { label })
  }
}

export function DebugStatusRow({ state, t }: StatusProps) {
  if (state === undefined || state === null) return null

  const label = labelFor(state, t)
  const statusText = statusTextFor(state, t)
  const terminal = state.phase === 'completed' || state.phase === 'cancelled'
  const failed = state.phase === 'failed'
  const rowClass = [
    css.row,
    state.phase === 'waiting' ? css.waiting : '',
    terminal ? css.terminal : '',
    failed ? css.failed : '',
  ].filter(Boolean).join(' ')
  const total = Math.max(state.totalSteps, 0)
  const current = Math.min(Math.max(state.currentStep, 0), total)
  const ariaMax = Math.max(total, 1)
  const percentage = total === 0 ? 0 : Math.round((current / total) * 100)
  if (state.phase === 'failed') {
    const message = state.errorMessage ?? state.errorCode ?? 'Unknown error'
    return (
      <div className={css.dock} data-debug-status={state.phase} role="alert" aria-live="assertive" aria-atomic="true" title={message}>
        <div className={rowClass}>
          <span className={css.label}>{statusText}</span>
          <span className={css.counter}>{current}/{total}</span>
          <div
            className={css.track}
            role="progressbar"
            aria-label={t('progress.aria', { label })}
            aria-valuemin={0}
            aria-valuemax={ariaMax}
            aria-valuenow={Math.min(current, ariaMax)}
          >
            <div className={css.fill} style={{ width: `${percentage}%` }} />
          </div>
          <span className={css.error}>{message}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={css.dock} data-debug-status={state.phase} role="status" aria-live="polite" aria-atomic="true">
      <div className={rowClass}>
        <span className={css.label}>{statusText}</span>
        <span className={css.counter}>{current}/{total}</span>
        <div
          className={css.track}
          role="progressbar"
          aria-label={t('progress.aria', { label })}
          aria-valuemin={0}
          aria-valuemax={ariaMax}
          aria-valuenow={Math.min(current, ariaMax)}
        >
          <div className={css.fill} style={{ width: `${percentage}%` }} />
        </div>
        {state.phase === 'waiting' && <span className={css.context}>{t('waiting.detail')}</span>}
      </div>
    </div>
  )
}

export function DebugStatusDock({ useProjection, t }: DebugStatusRowProps) {
  return <DebugStatusRow state={useProjection('debugStatus')} t={t} />
}
