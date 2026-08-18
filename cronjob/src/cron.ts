import { randomUUID } from 'node:crypto'
import type { CronSchedule } from './types.js'

export const MAX_TIMER_DELAY_MS = 2_147_483_647
export const RETRY_BACKOFF_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const

export class CronInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronInputError'
  }
}

export function allocateId(prefix = 'cron'): string {
  return `${prefix}_${randomUUID()}`
}

export function validateSchedule(schedule: CronSchedule, now = Date.now()): number {
  if (!isRecord(schedule) || typeof schedule.kind !== 'string') {
    throw new CronInputError('schedule must be an at, every, or cron object')
  }
  if (schedule.kind === 'at') {
    if (typeof schedule.at !== 'string' || !Number.isFinite(Date.parse(schedule.at))) {
      throw new CronInputError('schedule.at must be a valid ISO timestamp')
    }
    const target = Date.parse(schedule.at)
    if (target <= now) throw new CronInputError('schedule.at must be in the future')
    return target
  }
  if (schedule.kind === 'every') {
    if (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs <= 0) {
      throw new CronInputError('schedule.everyMs must be a positive safe integer')
    }
    return now + schedule.everyMs
  }
  if (schedule.kind === 'cron') {
    validateCronExpression(schedule.expr)
    validateTimeZone(schedule.tz)
    return nextCronRun(schedule.expr, now, schedule.tz)
  }
  throw new CronInputError(`unsupported schedule kind: ${schedule.kind}`)
}

export function nextRunAt(schedule: CronSchedule, previous: number, now = Date.now()): number {
  if (schedule.kind === 'at') return previous
  if (schedule.kind === 'every') {
    const steps = Math.max(1, Math.floor((now - previous) / schedule.everyMs) + 1)
    return previous + steps * schedule.everyMs
  }
  return nextCronRun(schedule.expr, Math.max(previous, now), schedule.tz)
}

export function validateCronExpression(expression: string): void {
  const fields = expression.trim().split(/\s+/u)
  if (fields.length !== 5 && fields.length !== 6) {
    throw new CronInputError('cron expression must contain 5 or 6 fields')
  }
  const ranges = fields.length === 5
    ? [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
    : [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  fields.forEach((field, index) => parseField(field, ranges[index]![0], ranges[index]![1]))
}

export function nextCronRun(expression: string, after: number, timeZone?: string): number {
  validateCronExpression(expression)
  validateTimeZone(timeZone)
  const fields = expression.trim().split(/\s+/u)
  const hasSeconds = fields.length === 6
  const parsed = (hasSeconds ? fields : ['0', ...fields]).map((field, index) => parseField(
    field,
    index === 0 ? 0 : index === 1 ? 0 : index === 2 ? 0 : index === 3 ? 1 : index === 4 ? 1 : 0,
    index === 0 ? 59 : index === 1 ? 59 : index === 2 ? 23 : index === 3 ? 31 : index === 4 ? 12 : 7,
  ))
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const step = hasSeconds ? 1_000 : 60_000
  let candidate = hasSeconds ? Math.floor(after / 1_000) * 1_000 + 1_000 : Math.floor(after / 60_000) * 60_000 + 60_000
  const limit = candidate + 366 * 24 * 60 * 60 * 1_000
  for (; candidate <= limit; candidate += step) {
    const parts = localParts(formatter, candidate)
    const values = hasSeconds
      ? [parts.second, parts.minute, parts.hour, parts.day, parts.month, parts.weekday]
      : [parts.minute, parts.hour, parts.day, parts.month, parts.weekday]
    if (values.every((value, index) => parsed[index]!.has(value))) return candidate
  }
  throw new CronInputError('cron expression has no occurrence within one year')
}

function parseField(value: string, min: number, max: number): Set<number> {
  const result = new Set<number>()
  for (const part of value.split(',')) {
    const [rangePart, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isSafeInteger(step) || step <= 0) throw new CronInputError(`invalid cron field: ${value}`)
    const range = rangePart === '*' || rangePart === undefined ? [min, max] : rangePart.split('-').map(Number)
    if (range.some(number => !Number.isSafeInteger(number)) || range.length > 2) {
      throw new CronInputError(`invalid cron field: ${value}`)
    }
    const start = range[0]!
    const end = range[1] ?? start
    if (start < min || end > max || start > end) throw new CronInputError(`cron field out of range: ${value}`)
    for (let number = start; number <= end; number += step) result.add(number)
  }
  return result
}

function validateTimeZone(timeZone: string | undefined): void {
  if (timeZone === undefined) return
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    throw new CronInputError(`invalid IANA time zone: ${timeZone}`)
  }
}

function localParts(formatter: Intl.DateTimeFormat, value: number) {
  const parts = Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value]))
  const date = new Date(value)
  return {
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: date.getUTCDay(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
