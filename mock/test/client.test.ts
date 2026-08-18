import { describe, expect, it } from 'vitest'
import { statusTextFor } from '../src/client/MockStatusRow.js'
import type { MockUiState } from '../src/types.js'

const t = (key: string, params?: Record<string, string | number>): string => {
  const template: Record<string, string> = {
    'run.label': 'Mock run',
    'replay.label': 'Mock replay',
    'status.queued': '{label} queued',
    'status.running': '{label} running',
    'status.waiting': '{label} waiting for tool result',
    'status.failed': '{label} failed',
    'status.completed': '{label} completed',
    'status.cancelled': '{label} cancelled',
  }
  return (template[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
}

function state(phase: MockUiState['phase']): MockUiState {
  return {
    sessionId: 'client-session',
    runId: 'run-client',
    mode: 'replay',
    phase,
    currentStep: 2,
    totalSteps: 3,
  }
}

describe('mock status accessibility copy', () => {
  it('exposes waiting context instead of only dimming the progress bar', () => {
    expect(statusTextFor(state('waiting'), t)).toBe('Mock replay waiting for tool result')
  })

  it('keeps terminal states announceable', () => {
    expect(statusTextFor(state('completed'), t)).toBe('Mock replay completed')
    expect(statusTextFor(state('cancelled'), t)).toBe('Mock replay cancelled')
    expect(statusTextFor(state('failed'), t)).toBe('Mock replay failed')
  })
})
