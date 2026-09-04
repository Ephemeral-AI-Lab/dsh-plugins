import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  KNOWN_SESSION_EVENT_TYPES,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
} from '@deepseek-ai/dsh-session'
import {
  PersistenceCoordinator,
  SessionPersistenceRevision,
  type PersistenceBackend,
  type StoredPrefix,
} from '@deepseek-ai/dsh-session-persistence'
import { describe, expect, it } from 'vitest'
import { createLoopRecord, foldLoopEvents } from '../src/loop.js'

type Entry = { meta: SessionHeader; events: SessionEvent[] }

class MemoryBackend implements PersistenceBackend<never> {
  readonly name = 'loop-test-memory'
  readonly entries = new Map<string, Entry>()

  async loadStored(id: SessionId): Promise<StoredPrefix<never> | undefined> {
    const entry = this.entries.get(id)
    if (entry === undefined) return undefined
    return {
      meta: structuredClone(entry.meta),
      events: structuredClone(entry.events),
      revision: this.revision(entry),
    }
  }

  async readStoredRevision(id: SessionId): Promise<ReturnType<typeof SessionPersistenceRevision> | undefined> {
    const entry = this.entries.get(id)
    return entry === undefined ? undefined : this.revision(entry)
  }

  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
    const entry = this.entries.get(meta.id)
    if (entry === undefined) {
      this.entries.set(meta.id, { meta: structuredClone(meta), events: structuredClone(events) as SessionEvent[] })
    } else {
      entry.events.push(...structuredClone(events) as SessionEvent[])
    }
  }

  async commitRepair(meta: SessionHeader, _tornMarker: never | undefined, closers: readonly SessionEvent[]): Promise<void> {
    const entry = this.entries.get(meta.id)
    entry?.events.push(...structuredClone(closers) as SessionEvent[])
  }

  async list(): Promise<SessionHeader[]> {
    return [...this.entries.values()].map(entry => structuredClone(entry.meta))
  }

  private revision(entry: Entry): ReturnType<typeof SessionPersistenceRevision> {
    return SessionPersistenceRevision(JSON.stringify(entry))
  }
}

describe('loop persistence integration', () => {
  it('round-trips a loop change through the real coordinator and prepare/load path', async () => {
    KNOWN_SESSION_EVENT_TYPES.add('loop/change')
    const backend = new MemoryBackend()
    const first = await createPersistenceContext(backend)
    const record = createLoopRecord('persist me', 5, 0, 'loop_persist')
    const session = first.ctx.sessions.create('persisted-loop')
    session.append('loop/change' as never, {
      version: 1,
      operation: 'create',
      loop: record,
    } as never)
    expect(await first.ctx.sessions.flush(session)).toBe(true)

    const liveLoad = await first.coordinator.load(session.id)
    expect(foldLoopEvents(liveLoad.events).active).toEqual([record])
    await first.persistence.dispose()
    await first.store.dispose()

    const second = await createPersistenceContext(backend)
    try {
      const coldLoad = await second.coordinator.load(session.id)
      expect(foldLoopEvents(coldLoad.events).active).toEqual([record])

      const preparation = await second.coordinator.prepare(session.id)
      try {
        expect(preparation.session.id).toBe(session.id)
        expect(foldLoopEvents(preparation.session.events).active).toEqual([record])
      } finally {
        preparation[Symbol.dispose]()
      }
    } finally {
      await second.persistence.dispose()
      await second.store.dispose()
    }
  })
})

async function createPersistenceContext(backend: MemoryBackend): Promise<{
  ctx: Context
  coordinator: PersistenceCoordinator<never>
  store: { dispose(): Promise<void> }
  persistence: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  const store = await ctx.plugin(SessionStore)
  let coordinator!: PersistenceCoordinator<never>
  const persistence = await ctx.plugin({
    name: 'loop-test-persistence',
    inject: ['sessions'],
    apply(persistenceCtx) {
      coordinator = new PersistenceCoordinator(persistenceCtx, backend, {
        preparedSessionCacheSize: 2,
        writeBatchMaxDelayMs: 1,
      })
    },
  })
  return { ctx, coordinator, store, persistence }
}
