import { describe, expect, it } from 'vitest'
import { statusTextFor } from '../src/client/DebugStatusRow.js'
import type { DebugUiState } from '../src/types.js'

const t = (key: string, params?: Record<string, string | number>): string => {
  const template: Record<string, string> = {
    'run.label': 'Debug run',
    'replay.label': 'Debug replay',
    'status.queued': '{label} queued',
    'status.running': '{label} running',
    'status.waiting': '{label} waiting for tool result',
    'status.failed': '{label} failed',
    'status.completed': '{label} completed',
    'status.cancelled': '{label} cancelled',
  }
  return (template[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
}

function state(phase: DebugUiState['phase']): DebugUiState {
  return {
    sessionId: 'client-session',
    runId: 'run-client',
    mode: 'replay',
    phase,
    currentStep: 2,
    totalSteps: 3,
  }
}

describe('debug status accessibility copy', () => {
  it('exposes waiting context instead of only dimming the progress bar', () => {
    expect(statusTextFor(state('waiting'), t)).toBe('Debug replay waiting for tool result')
  })

  it('keeps terminal states announceable', () => {
    expect(statusTextFor(state('completed'), t)).toBe('Debug replay completed')
    expect(statusTextFor(state('cancelled'), t)).toBe('Debug replay cancelled')
    expect(statusTextFor(state('failed'), t)).toBe('Debug replay failed')
  })
})
