import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { CRONJOB_DOMAIN_VERSION, type CronJobRecord, type CronRunRecord } from './types.js'

const atScheduleSchema = z.object({
  kind: z.literal('at'),
  at: z.string().min(1),
}).strict()

const everyScheduleSchema = z.object({
  kind: z.literal('every'),
  everyMs: z.number().int().positive().safe(),
}).strict()

const cronScheduleSchema = z.object({
  kind: z.literal('cron'),
  expr: z.string().min(1),
  tz: z.string().min(1).optional(),
}).strict()

const scheduleSchema = z.discriminatedUnion('kind', [atScheduleSchema, everyScheduleSchema, cronScheduleSchema])

export const cronJobRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  schedule: scheduleSchema,
  enabled: z.boolean(),
  mode: z.enum(['isolated', 'persistent', 'current']),
  ownerSessionId: z.string().min(1),
  targetSessionId: z.string().min(1).optional(),
  preset: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  model_effort: z.string().min(1).optional(),
  deleteAfterRun: z.boolean(),
  createdAt: z.number().int().nonnegative().safe(),
  nextRunAt: z.number().int().nonnegative().safe(),
  lastRunAt: z.number().int().nonnegative().safe().optional(),
  lastRunStatus: z.enum(['running', 'ok', 'error', 'skipped']).optional(),
  failureCount: z.number().int().nonnegative().safe(),
  runCount: z.number().int().nonnegative().safe(),
}).strict()

export const cronRunRecordSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  status: z.enum(['running', 'ok', 'error', 'skipped']),
  startedAt: z.number().int().nonnegative().safe(),
  finishedAt: z.number().int().nonnegative().safe().optional(),
  sessionId: z.string().min(1).optional(),
  error: z.string().optional(),
}).strict()

export const cronjobDomainSpec = defineDomain({
  name: 'cronjob',
  version: CRONJOB_DOMAIN_VERSION,
  tables: {
    jobs: domainTable<string, CronJobRecord>(cronJobRecordSchema),
    runs: domainTable<string, CronRunRecord>(cronRunRecordSchema),
  },
})

export type CronjobDomain = Domain<typeof cronjobDomainSpec>

export async function openCronjobDomain(ctx: Context): Promise<CronjobDomain> {
  return ctx.storageDomain.open(cronjobDomainSpec)
}
