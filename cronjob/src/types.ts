import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const CRONJOB_DOMAIN_VERSION = 1 as const

export type CronSchedule =
  | { readonly kind: 'at'; readonly at: string }
  | { readonly kind: 'every'; readonly everyMs: number }
  | { readonly kind: 'cron'; readonly expr: string; readonly tz?: string }

export type CronMode = 'isolated' | 'persistent' | 'current'
export type CronRunStatus = 'running' | 'ok' | 'error' | 'skipped'

export interface CronJobRecord {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly schedule: CronSchedule
  readonly enabled: boolean
  readonly mode: CronMode
  readonly ownerSessionId: string
  readonly targetSessionId?: string
  readonly preset?: string
  readonly provider?: string
  readonly model?: string
  readonly model_effort?: string
  readonly deleteAfterRun: boolean
  readonly createdAt: number
  readonly nextRunAt: number
  readonly lastRunAt?: number
  readonly lastRunStatus?: CronRunStatus
  readonly failureCount: number
  readonly runCount: number
}

export interface CronRunRecord {
  readonly id: string
  readonly jobId: string
  readonly status: CronRunStatus
  readonly startedAt: number
  readonly finishedAt?: number
  readonly sessionId?: string
  readonly error?: string
}

export interface CronJobView extends CronJobRecord {
  readonly status: 'disabled' | 'running' | 'ok' | 'error' | 'idle'
}

export interface CronAddInput {
  readonly name: string
  readonly prompt: string
  readonly schedule: CronSchedule
  readonly mode?: CronMode
  readonly target_session_id?: string
  readonly preset?: string
  readonly provider?: string
  readonly model?: string
  readonly model_effort?: string
  readonly delete_after_run?: boolean
}

export interface CronUpdateInput {
  readonly name?: string
  readonly prompt?: string
  readonly schedule?: CronSchedule
  readonly enabled?: boolean
  readonly mode?: CronMode
  readonly target_session_id?: string | null
  readonly preset?: string | null
  readonly provider?: string | null
  readonly model?: string | null
  readonly model_effort?: string | null
  readonly delete_after_run?: boolean
}

export interface CronRunResult {
  readonly ok: true
  readonly enqueued: true
  readonly runId: string
}

export interface CronJobContext {
  readonly agent?: Agent
  readonly sessionId?: SessionId
}
