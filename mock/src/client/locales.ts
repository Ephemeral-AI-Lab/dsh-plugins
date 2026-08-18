/** Browser copy for the compact mock status row. */
export const NS = 'mockAgent'

export const zh = {
  'run.label': 'Mock run',
  'replay.label': 'Mock replay',
  'progress.aria': '{label} progress',
  'status.queued': '{label} queued',
  'status.running': '{label} running',
  'status.waiting': '{label} waiting for tool result',
  'status.failed': '{label} failed',
  'status.completed': '{label} completed',
  'status.cancelled': '{label} cancelled',
  'waiting.detail': 'Waiting for the tool to finish…',
} as const

export const en: Record<MockAgentKey, string> = { ...zh }

en['run.label'] = 'Mock run'
en['replay.label'] = 'Mock replay'
en['progress.aria'] = '{label} progress'
en['status.queued'] = '{label} queued'
en['status.running'] = '{label} running'
en['status.waiting'] = '{label} waiting for tool result'
en['status.failed'] = '{label} failed'
en['status.completed'] = '{label} completed'
en['status.cancelled'] = '{label} cancelled'
en['waiting.detail'] = 'Waiting for the tool to finish…'

export type MockAgentKey = keyof typeof zh
