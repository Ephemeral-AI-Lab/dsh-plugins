import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SideChatAddress,
  SideChatAnchorSummary,
  SideChatCloseValue,
  SideChatId,
  SideChatInputBlock,
  SideChatOpenValue,
  SideChatResult,
  SideChatSnapshot,
  SideChatStopValue,
  SideChatSubmitValue,
} from '../types.js'

export interface SideChatTab {
  id: SideChatId
  capability: string
  title: string
  anchor: SideChatAnchorSummary
  remote: SideChatSnapshot
  loading: boolean
  error: string | undefined
}

export interface SideChatStoreSnapshot {
  tabs: readonly SideChatTab[]
  activeId: SideChatId | null
  opening: boolean
}

const EMPTY: SideChatStoreSnapshot = Object.freeze({
  tabs: Object.freeze([]),
  activeId: null,
  opening: false,
})

class SideChatClientError extends Error {}

export class SideChatClient {
  constructor(private readonly rpc: ClientConnectionRpc) {}

  async call<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const outer = await this.rpc.call('/sidechat', endpoint, payload, signal)
    if (!outer.ok) throw new SideChatClientError(outer.error.message)
    const inner = outer.value as SideChatResult<T> | undefined
    if (inner === undefined || typeof inner !== 'object' || typeof inner.ok !== 'boolean') {
      throw new SideChatClientError('sidechat returned an invalid response')
    }
    if (!inner.ok) throw new SideChatClientError(inner.error.message)
    return inner.value
  }
}

export class SideChatStore {
  private readonly listeners = new Set<() => void>()
  private snapshot: SideChatStoreSnapshot = EMPTY

  constructor(private readonly client: SideChatClient) {}

  getSnapshot = (): SideChatStoreSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async create(anchorSessionId: string, title: string): Promise<void> {
    if (this.snapshot.opening) return
    this.publish({ ...this.snapshot, opening: true })
    try {
      const opened = await this.client.call<SideChatOpenValue>('open', {
        anchorSessionId,
        anchorTitle: title,
      })
      const tab: SideChatTab = {
        id: opened.sideChatId,
        capability: opened.capability,
        title,
        anchor: opened.anchor,
        remote: {
          status: 'idle',
          messages: [],
          queuedCount: 0,
          anchor: opened.anchor,
        },
        loading: false,
        error: undefined,
      }
      this.publish({
        tabs: [...this.snapshot.tabs, tab],
        activeId: tab.id,
        opening: false,
      })
    } catch (error: unknown) {
      this.publish({ ...this.snapshot, opening: false })
      throw error
    }
  }

  select(id: SideChatId): void {
    if (!this.snapshot.tabs.some(tab => tab.id === id)) return
    this.publish({ ...this.snapshot, activeId: id })
  }

  async submit(id: SideChatId, text: string, delivery: 'followup' | 'steer'): Promise<void> {
    const tab = this.find(id)
    if (tab === undefined) return
    this.patch(id, { loading: true, error: undefined })
    try {
      await this.client.call<SideChatSubmitValue>('submit', {
        ...address(tab),
        content: [{ type: 'text', text }] satisfies SideChatInputBlock[],
        delivery,
      })
      await this.pull(id)
    } catch (error: unknown) {
      this.patch(id, { loading: false, error: messageOf(error) })
    }
  }

  async pull(id: SideChatId): Promise<void> {
    const tab = this.find(id)
    if (tab === undefined) return
    try {
      const remote = await this.client.call<SideChatSnapshot>('snapshot', address(tab))
      this.patch(id, {
        remote,
        anchor: remote.anchor,
        loading: false,
        error: remote.error,
      })
    } catch (error: unknown) {
      this.patch(id, { loading: false, error: messageOf(error) })
    }
  }

  async refreshAnchor(id: SideChatId): Promise<void> {
    const tab = this.find(id)
    if (tab === undefined) return
    this.patch(id, { loading: true, error: undefined })
    try {
      const anchor = await this.client.call<SideChatAnchorSummary>('refresh', address(tab))
      this.patch(id, { anchor, remote: { ...tab.remote, anchor }, loading: false })
    } catch (error: unknown) {
      this.patch(id, { loading: false, error: messageOf(error) })
    }
  }

  async stop(id: SideChatId): Promise<void> {
    const tab = this.find(id)
    if (tab === undefined) return
    try {
      await this.client.call<SideChatStopValue>('stop', address(tab))
      await this.pull(id)
    } catch (error: unknown) {
      this.patch(id, { error: messageOf(error) })
    }
  }

  async close(id: SideChatId): Promise<void> {
    const tab = this.find(id)
    if (tab === undefined) return
    const tabs = this.snapshot.tabs.filter(candidate => candidate.id !== id)
    const activeId = this.snapshot.activeId === id
      ? tabs.at(-1)?.id ?? null
      : this.snapshot.activeId
    this.publish({ ...this.snapshot, tabs, activeId })
    try {
      await this.client.call<SideChatCloseValue>('close', address(tab))
    } catch {
      // Local removal is authoritative for this browser; Host TTL handles loss.
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.snapshot.tabs.map(tab =>
      this.client.call<SideChatCloseValue>('close', address(tab))))
    this.publish(EMPTY)
  }

  private find(id: SideChatId): SideChatTab | undefined {
    return this.snapshot.tabs.find(tab => tab.id === id)
  }

  private patch(id: SideChatId, patch: Partial<SideChatTab>): void {
    const tabs = this.snapshot.tabs.map(tab => tab.id === id ? { ...tab, ...patch } : tab)
    this.publish({ ...this.snapshot, tabs })
  }

  private publish(next: SideChatStoreSnapshot): void {
    this.snapshot = Object.freeze({ ...next, tabs: Object.freeze([...next.tabs]) })
    for (const listener of this.listeners) listener()
  }
}

function address(tab: SideChatTab): SideChatAddress {
  return { sideChatId: tab.id, capability: tab.capability }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
