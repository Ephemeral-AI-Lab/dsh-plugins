import { SessionId as makeSessionId } from '@deepseek-ai/dsh-session';
export const LIST_STATUS_DEFAULT_RECENT_N = 50;
export class SessionsService {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async listStatus(args = {}, signal) {
        validateRecentN(args.recent_n);
        if (args.session_id !== undefined) {
            return { sessions: [await this.readStatus(args.session_id, signal)] };
        }
        const headers = await this.ctx.sessionPersistence.list(signal);
        const liveAgents = this.ctx.agents.list();
        const records = new Map();
        for (const header of headers) {
            records.set(String(header.id), { header, agent: undefined });
        }
        for (const agent of liveAgents) {
            records.set(String(agent.id), { header: agent.session.header, agent });
        }
        const ids = [...records.keys()];
        const titles = await this.readTitles(ids, signal);
        const sessions = [...records.entries()].map(([id, record]) => {
            const updatedAt = latestEventTime(record.agent) ?? record.header.createdAt;
            const title = titles.get(id);
            const sessionPath = persistedSessionPath(this.ctx, record.header);
            return {
                session_id: id,
                ...title === undefined ? {} : { title },
                status: statusOf(record.agent),
                updated_at: new Date(updatedAt).toISOString(),
                ...sessionPath === undefined ? {} : { session_path: sessionPath },
            };
        });
        sessions.sort((left, right) => {
            const timeOrder = right.updated_at.localeCompare(left.updated_at);
            return timeOrder === 0 ? left.session_id.localeCompare(right.session_id) : timeOrder;
        });
        return {
            sessions: sessions.slice(0, args.recent_n ?? LIST_STATUS_DEFAULT_RECENT_N),
        };
    }
    async readStatus(sessionId, signal) {
        requireSessionId(sessionId);
        const id = sessionId.trim();
        const agent = this.ctx.agents.get(makeSessionId(id));
        const header = agent?.session.header ?? (await this.ctx.sessionPersistence.list(signal))
            .find(candidate => String(candidate.id) === id);
        if (header === undefined)
            return { session_id: id, status: 'missing' };
        const titles = await this.readTitles([id], signal);
        const title = titles.get(id);
        const updatedAt = latestEventTime(agent) ?? header.createdAt;
        const sessionPath = persistedSessionPath(this.ctx, header);
        return {
            session_id: id,
            ...title === undefined ? {} : { title },
            status: statusOf(agent),
            updated_at: new Date(updatedAt).toISOString(),
            ...sessionPath === undefined ? {} : { session_path: sessionPath },
        };
    }
    async readTitles(ids, signal) {
        if (ids.length === 0)
            return new Map();
        const results = await this.ctx.sessionQuery.readTitleSnapshots(ids.map(id => makeSessionId(id)), signal);
        const titles = new Map();
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.title !== undefined) {
                titles.set(String(result.value.session.id), result.value.title.title);
            }
        }
        return titles;
    }
}
function statusOf(agent) {
    return agent?.status === 'running' ? 'running' : agent === undefined ? 'cold' : 'idle';
}
function latestEventTime(agent) {
    return agent?.session.events.at(-1)?.time;
}
function persistedSessionPath(ctx, header) {
    return ctx.sessionPersistence
        .locate?.(header)?.path;
}
export function validateRecentN(recentN) {
    if (recentN !== undefined && (!Number.isSafeInteger(recentN) || recentN <= 0)) {
        throw new Error('recent_n must be a positive safe integer');
    }
}
function requireSessionId(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('session_id must be a non-empty string');
    }
}
//# sourceMappingURL=service.js.map