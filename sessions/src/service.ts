import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId as makeSessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import type {
  ListStatusArgs,
  ListStatusResult,
  SessionStatus,
  SessionStatusView,
} from './types.js'

export const LIST_STATUS_DEFAULT_RECENT_N = 50

export class SessionsService {
  constructor(private readonly ctx: Context) {}

  async listStatus(args: ListStatusArgs = {}, signal?: AbortSignal): Promise<ListStatusResult> {
    validateRecentN(args.recent_n)
    if (args.session_id !== undefined) {
      return { sessions: [await this.readStatus(args.session_id, signal)] }
    }

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
      const sessionPath = persistedSessionPath(this.ctx, record.header)
      return {
        session_id: id,
        ...title === undefined ? {} : { title },
        status: statusOf(record.agent),
        updated_at: new Date(updatedAt).toISOString(),
        ...sessionPath === undefined ? {} : { session_path: sessionPath },
      } satisfies SessionStatusView
    })

    sessions.sort((left, right) => {
      const timeOrder = right.updated_at.localeCompare(left.updated_at)
      return timeOrder === 0 ? left.session_id.localeCompare(right.session_id) : timeOrder
    })

    return {
      sessions: sessions.slice(0, args.recent_n ?? LIST_STATUS_DEFAULT_RECENT_N),
    }
  }

  private async readStatus(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SessionStatusView> {
    requireSessionId(sessionId)
    const id = sessionId.trim()
    const agent = this.ctx.agents.get(makeSessionId(id))
    const header = agent?.session.header ?? (await this.ctx.sessionPersistence.list(signal))
      .find(candidate => String(candidate.id) === id)

    if (header === undefined) return { session_id: id, status: 'missing' }

    const titles = await this.readTitles([id], signal)
    const title = titles.get(id)
    const updatedAt = latestEventTime(agent) ?? header.createdAt
    const sessionPath = persistedSessionPath(this.ctx, header)
    return {
      session_id: id,
      ...title === undefined ? {} : { title },
      status: statusOf(agent),
      updated_at: new Date(updatedAt).toISOString(),
      ...sessionPath === undefined ? {} : { session_path: sessionPath },
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

function persistedSessionPath(ctx: Context, header: SessionHeader): string | undefined {
  return (ctx.sessionPersistence as { locate?: (meta: SessionHeader) => { path: string } | undefined })
    .locate?.(header)?.path
}

export function validateRecentN(recentN: number | undefined): void {
  if (recentN !== undefined && (!Number.isSafeInteger(recentN) || recentN <= 0)) {
    throw new Error('recent_n must be a positive safe integer')
  }
}

function requireSessionId(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('session_id must be a non-empty string')
  }
}
