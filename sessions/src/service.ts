import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId as makeSessionId, Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import type {
  CheckSessionStatusArgs,
  ListSessionsArgs,
  ListSessionsResult,
  ReadSessionArgs,
  ReadSessionMessage,
  ReadSessionResult,
  SessionStatus,
  SessionStatusView,
  SessionView,
} from './types.js'

export const READ_SESSION_LIMIT = 200

export class SessionsService {
  constructor(private readonly ctx: Context) {}

  async listSessions(args: ListSessionsArgs = {}, signal?: AbortSignal): Promise<ListSessionsResult> {
    validateLimit(args.limit)

    const headers = await this.ctx.sessionPersistence.list(signal)
    const liveAgents = this.ctx.agents.list()
    const records = new Map<string, SessionRecord>()

    for (const header of headers) {
      records.set(String(header.id), { header, agent: undefined })
    }
    for (const agent of liveAgents) {
      records.set(String(agent.id), { header: agent.session.header, agent })
    }

    const ids = [...records.keys()]
    const titles = await this.readTitles(ids, signal)
    const sessions = [...records.entries()].map(([id, record]) => {
      const updatedAt = latestEventTime(record.agent) ?? record.header.createdAt
      const title = titles.get(id)
      return {
        session_id: id,
        ...title === undefined ? {} : { title },
        status: statusOf(record.agent),
        updated_at: new Date(updatedAt).toISOString(),
      } satisfies SessionView
    })

    sessions.sort((left, right) => {
      const timeOrder = right.updated_at.localeCompare(left.updated_at)
      return timeOrder === 0 ? left.session_id.localeCompare(right.session_id) : timeOrder
    })

    return {
      sessions: args.limit === undefined ? sessions : sessions.slice(0, args.limit),
    }
  }

  async checkSessionStatus(
    args: CheckSessionStatusArgs,
    signal?: AbortSignal,
  ): Promise<SessionStatusView> {
    requireSessionId(args.session_id)
    const id = args.session_id
    const agent = this.ctx.agents.get(makeSessionId(id))
    const header = agent?.session.header ?? (await this.ctx.sessionPersistence.list(signal))
      .find(candidate => String(candidate.id) === id)

    if (header === undefined) return { session_id: id, status: 'missing' }

    const titles = await this.readTitles([id], signal)
    const title = titles.get(id)
    const updatedAt = latestEventTime(agent) ?? header.createdAt
    return {
      session_id: id,
      ...title === undefined ? {} : { title },
      status: statusOf(agent),
      updated_at: new Date(updatedAt).toISOString(),
    }
  }

  async readSession(args: ReadSessionArgs, signal?: AbortSignal): Promise<ReadSessionResult> {
    const input = parseReadSessionArgs(args)
    const id = makeSessionId(input.session_id)
    const live = this.ctx.agents.get(id)
    const source: readonly ReadSessionMessage[] = live === undefined
      ? reconstructMessages(id, await this.ctx.sessionPersistence.inspect(id, signal))
      : live.session.deriveMessages().map(toReadSessionMessage)
    if (input.offset > source.length && !(source.length === 0 && input.offset === 1)) {
      throw new Error(`offset ${input.offset} is out of range for session "${input.session_id}" (${source.length} messages)`)
    }
    const messages = source.slice(input.offset - 1, input.offset - 1 + input.limit)
    return {
      session_id: input.session_id,
      offset: input.offset,
      messages,
      total_messages: source.length,
    }
  }

  private async readTitles(ids: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()

    const results = await this.ctx.sessionQuery.readTitleSnapshots(
      ids.map(id => makeSessionId(id)),
      signal,
    )
    const titles = new Map<string, string>()
    for (const result of results as SessionTitleObservationResult[]) {
      if (result.status === 'fulfilled' && result.value.title !== undefined) {
        titles.set(String(result.value.session.id), result.value.title.title)
      }
    }
    return titles
  }
}

interface SessionRecord {
  header: SessionHeader
  agent: Agent | undefined
}

function statusOf(agent: Agent | undefined): SessionStatus {
  return agent?.status === 'running' ? 'running' : agent === undefined ? 'cold' : 'idle'
}

function latestEventTime(agent: Agent | undefined): number | undefined {
  return agent?.session.events.at(-1)?.time
}

export function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error('limit must be a positive safe integer')
  }
}

export function parseReadSessionArgs(args: ReadSessionArgs): { session_id: string; offset: number; limit: number } {
  requireSessionId(args.session_id)
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? READ_SESSION_LIMIT : parsePositiveInteger(args.limit, 'limit')
  if (limit > READ_SESSION_LIMIT) throw new Error(`limit must be less than or equal to ${READ_SESSION_LIMIT}`)
  return { session_id: args.session_id.trim(), offset, limit }
}

function parsePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function reconstructMessages(id: ReturnType<typeof makeSessionId>, inspection: {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
}): readonly ReadSessionMessage[] {
  const session = Session.create(id, inspection.events, inspection.meta)
  return session.deriveMessages().map(toReadSessionMessage)
}

function toReadSessionMessage(message: ReturnType<Session['deriveMessages']>[number]): ReadSessionMessage {
  return message as unknown as ReadSessionMessage
}

function requireSessionId(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('session_id must be a non-empty string')
  }
}
