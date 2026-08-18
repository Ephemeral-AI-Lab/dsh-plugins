/** Browser copy for the compact debug status row. */
export const NS = 'debugAgent'

export const zh = {
  'run.label': 'Debug run',
  'replay.label': 'Debug replay',
  'progress.aria': '{label} progress',
  'status.queued': '{label} queued',
  'status.running': '{label} running',
  'status.waiting': '{label} waiting for tool result',
  'status.failed': '{label} failed',
  'status.completed': '{label} completed',
  'status.cancelled': '{label} cancelled',
  'waiting.detail': 'Waiting for the tool to finish…',
} as const

export const en: Record<DebugAgentKey, string> = { ...zh }

en['run.label'] = 'Debug run'
en['replay.label'] = 'Debug replay'
en['progress.aria'] = '{label} progress'
en['status.queued'] = '{label} queued'
en['status.running'] = '{label} running'
en['status.waiting'] = '{label} waiting for tool result'
en['status.failed'] = '{label} failed'
en['status.completed'] = '{label} completed'
en['status.cancelled'] = '{label} cancelled'
en['waiting.detail'] = 'Waiting for the tool to finish…'

export type DebugAgentKey = keyof typeof zh
