import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId as makeSessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { randomUUID } from 'node:crypto'
import type {
  CreateSessionResult,
  ListSessionsArgs,
  ListSessionsResult,
  ReadSessionArgs,
  ReadSessionResult,
  SendMessageArgs,
  SendMessageResult,
  SessionSnapshot,
  SessionSummary,
  WaitSessionsArgs,
  WaitSessionsResult,
} from './types.js'

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MAX_WAIT_TIMEOUT_MS = 120_000

export class SessionCommunicationService {
  private readonly ownedHandles = new Map<SessionId, AgentHandle>()
  private readonly persistence: SessionPersistence

  constructor(private readonly ctx: Context) {
    this.persistence = ctx.sessionPersistence
  }

  async createSession(prompt: string, parent?: Agent): Promise<CreateSessionResult> {
    requireText(prompt, 'prompt')

    const sessionId = makeSessionId(randomUUID())
    const owner = parent?.ctx ?? this.ctx
    const handle = await owner.agents.create({
      sessionId,
      ...parent === undefined ? {} : { meta: sessionMeta(parent) },
      ...parent === undefined ? {} : {
        agentOptions: parent.options,
        setup: inheritComposition(parent),
      },
    })
    this.ownedHandles.set(sessionId, handle)

    try {
      handle.agent.followup(userMessage(prompt))
    } catch (error: unknown) {
      this.ownedHandles.delete(sessionId)
      await handle.dispose()
      throw error
    }

    return { session_id: String(sessionId) }
  }

  async sendMessage(args: SendMessageArgs, parent?: Agent): Promise<SendMessageResult> {
    const sessionId = toSessionId(args.session_id, 'session_id')
    requireText(args.message, 'message')

    let agent = this.ctx.agents.get(sessionId)
    let resumed: AgentHandle | undefined
    if (agent === undefined) {
      const owner = parent?.ctx ?? this.ctx
      resumed = await owner.agents.resume({
        resumeSessionId: sessionId,
        ...parent === undefined ? {} : {
          agentOptions: parent.options,
          setup: inheritComposition(parent),
        },
      })
      this.ownedHandles.set(sessionId, resumed)
      agent = resumed.agent
    }

    const message = userMessage(args.message)
    try {
      agent.followup(message)
    } catch (error: unknown) {
      if (resumed !== undefined) {
        this.ownedHandles.delete(sessionId)
        await resumed.dispose()
      }
      throw error
    }

    return { message_id: String(message.id) }
  }

  async waitSessions(args: WaitSessionsArgs, signal?: AbortSignal): Promise<WaitSessionsResult> {
    const sessionIds = toSessionIds(args.session_ids)
    const after = validateAfter(args.after)
    const timeoutMs = validateTimeout(args.timeout_ms)
    const ids = new Set(sessionIds.map(String))

    if (signal?.aborted) throw signal.reason ?? new Error('wait_sessions aborted')

    if (timeoutMs === 0) {
      return { sessions: await this.snapshot(sessionIds, after), timed_out: false }
    }

    return new Promise<WaitSessionsResult>((resolve, reject) => {
      let settled = false
      let removeSessionListener: () => void = () => {}
      let removeStatusListener: () => void = () => {}
      let removeAbortListener: () => void = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const statusChanges = new Set<string>()

      const cleanup = (): void => {
        removeSessionListener()
        removeStatusListener()
        removeAbortListener()
        if (timer !== undefined) clearTimeout(timer)
      }

      const abort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(signal?.reason ?? new Error('wait_sessions aborted'))
      }

      const finish = (timedOut: boolean): void => {
        if (settled) return
        settled = true
        cleanup()
        void this.snapshot(sessionIds, after, statusChanges).then(
          sessions => resolve({ sessions, timed_out: timedOut }),
          reject,
        )
      }

      removeSessionListener = this.ctx.on('session/event', (session: Session, _event: SessionEvent) => {
        if (ids.has(String(session.id))) finish(false)
      })
      removeStatusListener = this.ctx.on('agent/status', ({ agent }: { agent: Agent }) => {
        const id = String(agent.id)
        if (ids.has(id)) {
          statusChanges.add(id)
          finish(false)
        }
      })
      if (signal !== undefined) {
        signal.addEventListener('abort', abort, { once: true })
        removeAbortListener = () => signal.removeEventListener('abort', abort)
        if (signal.aborted) abort()
      }
      timer = setTimeout(() => finish(true), timeoutMs)

      // The listeners are installed before this check so an event cannot win a race with the snapshot.
      void this.snapshot(sessionIds, after, statusChanges).then(sessions => {
        if (sessions.some(session => session.changed)) finish(false)
      }, error => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
    })
  }

  async readSession(args: ReadSessionArgs): Promise<ReadSessionResult> {
    const sessionId = toSessionId(args.session_id, 'session_id')
    const afterSeq = validateAfterSeq(args.after_seq)
    const limit = validateLimit(args.limit)
    const fromSeq = afterSeq + 1
    const result = await this.persistence.readFrom(sessionId, fromSeq)
    const events = limit === undefined ? result.events : result.events.slice(0, limit)
    const nextSeq = events.length === 0 ? fromSeq : events.at(-1)!.seq + 1

    return {
      events: events as unknown as ReadSessionResult['events'],
      next_seq: nextSeq,
      has_more: events.length < result.events.length,
    }
  }

  async listSessions(args: ListSessionsArgs): Promise<ListSessionsResult> {
    const limit = validateLimit(args.limit)
    const headers = await this.persistence.list()
    const live = new Map(this.ctx.agents.list().map(agent => [String(agent.id), agent]))
    const sessions = new Map<string, SessionSummary>()

    for (const header of headers) {
      const agent = live.get(String(header.id))
      sessions.set(String(header.id), summary(header, agent))
    }
    for (const agent of live.values()) {
      const id = String(agent.id)
      if (!sessions.has(id)) sessions.set(id, summary(agent.session.header, agent))
    }

    const values = [...sessions.values()]
    return { sessions: limit === undefined ? values : values.slice(0, limit) }
  }

  async dispose(): Promise<void> {
    const handles = [...this.ownedHandles.values()]
    this.ownedHandles.clear()
    await Promise.all(handles.map(handle => handle.dispose()))
  }

  private async snapshot(
    sessionIds: readonly SessionId[],
    after: Readonly<Record<string, number>>,
    statusChanges: ReadonlySet<string> = new Set(),
  ): Promise<SessionSnapshot[]> {
    const headers = await this.persistence.list()
    const known = new Map(headers.map(header => [String(header.id), header]))

    return Promise.all(sessionIds.map(async sessionId => {
      const id = String(sessionId)
      const cursor = after[id] ?? -1
      const agent = this.ctx.agents.get(sessionId)

      if (agent !== undefined) {
        return {
          session_id: id,
          status: agent.status,
          last_seq: agent.session.seq - 1,
          changed: statusChanges.has(id) || agent.session.seq - 1 > cursor,
        }
      }

      const header = known.get(id)
      if (header === undefined) {
        return { session_id: id, status: 'missing', last_seq: -1, changed: statusChanges.has(id) }
      }

      try {
        const inspection = await this.persistence.inspect(sessionId)
        const lastSeq = inspection.events.at(-1)?.seq ?? -1
        return {
          session_id: id,
          status: 'cold',
          last_seq: lastSeq,
          changed: statusChanges.has(id) || lastSeq > cursor,
        }
      } catch {
        return { session_id: id, status: 'error', last_seq: -1, changed: statusChanges.has(id) }
      }
    }))
  }
}

function inheritComposition(parent: Agent) {
  return (childCtx: Context): void => {
    const presets = parent.ctx.get('agentPresets') as {
      composeFrom(agentCtx: Context, parentCtx: Context): unknown
    } | undefined
    presets?.composeFrom(childCtx, parent.ctx)
  }
}

function sessionMeta(parent: Agent) {
  const cwd = parent.session.header.cwd
  return cwd === undefined ? {} : { cwd }
}

function userMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function summary(header: SessionHeader, agent: Agent | undefined) {
  const updatedAt = agent?.session.events.at(-1)?.time ?? header.createdAt
  return {
    session_id: String(header.id),
    status: agent?.status ?? 'cold',
    updated_at: new Date(updatedAt).toISOString(),
  } as const
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

function toSessionId(value: string, name: string): SessionId {
  requireText(value, name)
  return makeSessionId(value)
}

function toSessionIds(values: string[]): SessionId[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error('session_ids must not be empty')
  const result = values.map(value => toSessionId(value, 'session_id'))
  if (new Set(result.map(String)).size !== result.length) throw new Error('session_ids must be unique')
  return result
}

function validateAfter(after: Record<string, number> | undefined): Record<string, number> {
  if (after === undefined) return {}
  for (const [sessionId, sequence] of Object.entries(after)) {
    requireText(sessionId, 'session_id')
    if (!Number.isSafeInteger(sequence) || sequence < -1 || sequence === Number.MAX_SAFE_INTEGER) {
      throw new Error('after sequence values must be safe integers from -1 to MAX_SAFE_INTEGER - 1')
    }
  }
  return after
}

function validateAfterSeq(afterSeq: number | undefined): number {
  const value = afterSeq ?? -1
  if (!Number.isSafeInteger(value) || value < -1 || value === Number.MAX_SAFE_INTEGER) {
    throw new Error('after_seq must be a safe integer from -1 to MAX_SAFE_INTEGER - 1')
  }
  return value
}

function validateLimit(limit: number | undefined): number | undefined {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error('limit must be a positive safe integer')
  }
  return limit
}

function validateTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_WAIT_TIMEOUT_MS) {
    throw new Error(`timeout_ms must be a non-negative safe integer no greater than ${MAX_WAIT_TIMEOUT_MS}`)
  }
  return value
}
