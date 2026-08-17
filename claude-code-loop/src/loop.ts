import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import {
  LOOP_CHANGE_VERSION,
  type LoopChange,
  type LoopRecord,
  type LoopView,
} from './types.js'

export const MAX_TIMER_DELAY_MS = 2_147_483_647

export class LoopInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoopInputError'
  }
}

export class LoopLogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoopLogError'
  }
}

export interface FoldedLoops {
  readonly active: readonly LoopRecord[]
  readonly seenIds: readonly string[]
}

export function createLoopRecord(
  prompt: string,
  timeInSeconds: number,
  allowSteer = true,
  now = Date.now(),
  id = `loop_${randomUUID()}`,
): LoopRecord {
  validatePrompt(prompt)
  validateTime(timeInSeconds)
  if (typeof allowSteer !== 'boolean') throw new LoopInputError('allow_steer must be a boolean')
  if (!Number.isSafeInteger(now) || now < 0) throw new LoopInputError('now must be a non-negative safe integer')
  return {
    id,
    prompt: prompt.trim(),
    time_in_seconds: timeInSeconds,
    allow_steer: allowSteer,
    next_at: addSeconds(now, timeInSeconds),
  }
}

export function foldLoopEvents(events: readonly SessionEvent[], seedLength = 0): FoldedLoops {
  const active = new Map<string, LoopRecord>()
  const seenIds: string[] = []
  const suffix = events.slice(seedLength)

  for (const event of suffix) {
    if (event.type !== 'loop/change') continue
    applyChange(active, seenIds, event.data)
  }

  return { active: [...active.values()], seenIds }
}

export function loopView(record: LoopRecord, now = Date.now()): LoopView {
  return {
    ...record,
    state: record.next_at <= now ? 'overdue' : 'scheduled',
    delivery_mode: 'session-local',
  }
}

export function nextOccurrence(record: LoopRecord, now: number): number {
  const interval = record.time_in_seconds * 1000
  if (!Number.isSafeInteger(now) || now < record.next_at) return record.next_at
  const skipped = Math.floor((now - record.next_at) / interval) + 1
  return addMilliseconds(record.next_at, skipped * interval)
}

export function chooseDelivery(agent: Pick<Agent, 'status'>, allowSteer: boolean): 'steer' | 'followup' {
  return allowSteer && agent.status === 'running' ? 'steer' : 'followup'
}

export interface LoopRuntimeOptions {
  readonly ctx: Context
  readonly agent: Agent
}

/** One disposable timer projection for one exact agent. */
export class LoopRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private requested = false
  private running: Promise<void> | undefined
  private queue: Promise<void> = Promise.resolve()
  private stopping = false
  private disposal: Promise<void> | undefined

  constructor(private readonly options: LoopRuntimeOptions) {}

  start(): void {
    this.requestDrive()
  }

  requestDrive(): void {
    if (this.stopping) return
    this.clearTimer()
    this.requested = true
    if (this.running !== undefined) return

    const run = this.enqueue(async () => {
      while (this.requested && !this.stopping) {
        this.requested = false
        await this.driveOnce()
      }
    })
    this.running = run
    void run.then(() => {
      this.running = undefined
    }, () => {
      this.running = undefined
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  transact<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueue(task)
  }

  dispose(): Promise<void> {
    return (this.disposal ??= (async () => {
      this.stopping = true
      this.requested = false
      this.clearTimer()
      await Promise.allSettled([this.queue])
    })())
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async driveOnce(): Promise<void> {
    if (!this.isLive()) return
    await flushPersistence(this.options.ctx, this.options.agent)
    if (!this.isLive()) return

    const folded = foldLoopEvents(
      this.options.agent.session.events,
      this.options.agent.session.header.seedLength ?? 0,
    )
    const now = Date.now()
    const due = folded.active
      .filter(loop => loop.next_at <= now)
      .sort((left, right) => left.next_at - right.next_at)[0]

    if (due === undefined) {
      const next = folded.active
        .map(loop => loop.next_at)
        .sort((left, right) => left - right)[0]
      if (next !== undefined) this.arm(next, now)
      return
    }

    const message = createUserMessage({
      content: [{ type: 'text', text: due.prompt }],
      source: { kind: 'plugin', plugin: 'claude-code-loop' },
    })
    const delivery = chooseDelivery(this.options.agent, due.allow_steer)
    if (delivery === 'steer') this.options.agent.steer(message)
    else this.options.agent.followup(message)

    this.options.agent.session.append('loop/change', {
      version: LOOP_CHANGE_VERSION,
      operation: 'dispatch',
      id: due.id,
      next_at: nextOccurrence(due, now),
    })
    await flushPersistence(this.options.ctx, this.options.agent)
    this.requestDrive()
  }

  private arm(target: number, now: number): void {
    this.clearTimer()
    const delay = Math.max(0, Math.min(target - now, MAX_TIMER_DELAY_MS))
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.requestDrive()
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private isLive(): boolean {
    return this.options.ctx.agents.get(this.options.agent.id) === this.options.agent
  }
}

export async function flushPersistence(ctx: Context, agent: Agent): Promise<void> {
  if (!await ctx.sessions.flush(agent.session)) {
    throw new Error('Loop persistence did not complete')
  }
}

function applyChange(active: Map<string, LoopRecord>, seenIds: string[], change: LoopChange): void {
  if (change.version !== LOOP_CHANGE_VERSION) throw new LoopLogError('unsupported loop change version')
  if (change.operation === 'create') {
    validateRecord(change.loop)
    if (seenIds.includes(change.loop.id)) throw new LoopLogError(`duplicate loop id: ${change.loop.id}`)
    seenIds.push(change.loop.id)
    active.set(change.loop.id, change.loop)
    return
  }
  if (change.operation === 'delete') {
    if (!active.delete(change.id)) throw new LoopLogError(`cannot delete inactive loop: ${change.id}`)
    return
  }
  const loop = active.get(change.id)
  if (loop === undefined) throw new LoopLogError(`cannot dispatch inactive loop: ${change.id}`)
  if (!Number.isSafeInteger(change.next_at) || change.next_at <= loop.next_at) {
    throw new LoopLogError(`invalid next_at for loop: ${change.id}`)
  }
  active.set(change.id, { ...loop, next_at: change.next_at })
}

function validateRecord(record: LoopRecord): void {
  if (typeof record.id !== 'string' || record.id.trim() !== record.id || record.id.length === 0) {
    throw new LoopLogError('loop id must be a non-empty string without surrounding whitespace')
  }
  if (typeof record.prompt !== 'string' || record.prompt.trim().length === 0) {
    throw new LoopLogError('loop prompt must be non-empty')
  }
  validateLogTime(record.time_in_seconds)
  if (typeof record.allow_steer !== 'boolean') throw new LoopLogError('allow_steer must be boolean')
  if (!Number.isSafeInteger(record.next_at) || record.next_at < 0) throw new LoopLogError('loop next_at must be a non-negative safe integer')
}

function validatePrompt(prompt: string): void {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new LoopInputError('prompt must be non-empty')
}

function validateTime(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new LoopInputError('time_in_seconds must be a positive safe integer')
}

function validateLogTime(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new LoopLogError('time_in_seconds must be a positive safe integer')
}

function addSeconds(now: number, seconds: number): number {
  return addMilliseconds(now, seconds * 1000)
}

function addMilliseconds(now: number, milliseconds: number): number {
  const result = now + milliseconds
  if (!Number.isSafeInteger(result)) throw new LoopInputError('loop time is outside the safe date range')
  return result
}
