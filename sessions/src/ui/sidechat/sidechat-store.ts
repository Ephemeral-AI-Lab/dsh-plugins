import type { SideChatPanelState, SideChatResult, SideChatTabState } from '../../sidechat/sidechat-types.js'

const EMPTY: Readonly<Record<string, SideChatPanelState>> = Object.freeze({})

/** Root-scoped client state, partitioned by main session and real child id. */
export class SideChatStore {
  private value: Readonly<Record<string, SideChatPanelState>> = EMPTY
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): Readonly<Record<string, SideChatPanelState>> => this.value

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(mainSessionId: string, result: SideChatResult): void {
    const previous = this.value[mainSessionId] ?? {
      mainSessionId,
      open: false,
      activeSubagentId: null,
      tabs: [],
    }
    const existing = previous.tabs.find(tab => tab.subagentId === result.subagent_id)
    const tab: SideChatTabState = existing === undefined
      ? {
        subagentId: result.subagent_id,
        title: `Side chat ${previous.tabs.length + 1}`,
        status: 'running',
        residency: 'live',
        canContinue: true,
        unread: false,
      }
      : { ...existing, status: 'running', residency: 'live', canContinue: true }
    const tabs = existing === undefined
      ? [...previous.tabs, tab]
      : previous.tabs.map(item => item.subagentId === tab.subagentId ? tab : item)
    this.set({
      ...previous,
      open: true,
      activeSubagentId: result.subagent_id,
      tabs,
    }, mainSessionId)
  }

  close(mainSessionId: string): void {
    const current = this.value[mainSessionId]
    if (current !== undefined) this.set({ ...current, open: false }, mainSessionId)
  }

  select(mainSessionId: string, subagentId: string): void {
    const current = this.value[mainSessionId]
    if (current === undefined || !current.tabs.some(tab => tab.subagentId === subagentId)) return
    this.set({ ...current, open: true, activeSubagentId: subagentId, tabs: current.tabs.map(tab => tab.subagentId === subagentId ? { ...tab, unread: false } : tab) }, mainSessionId)
  }

  settle(
    mainSessionId: string,
    subagentId: string,
    status: SideChatTabState['status'],
    residency: SideChatTabState['residency'] = 'live',
    canContinue?: boolean,
  ): void {
    const current = this.value[mainSessionId]
    if (current === undefined) return
    this.set({
      ...current,
      tabs: current.tabs.map(tab => tab.subagentId === subagentId
        ? {
          ...tab,
          status,
          residency,
          ...(canContinue === undefined ? {} : { canContinue }),
          unread: current.activeSubagentId !== subagentId,
        }
        : tab),
    }, mainSessionId)
  }

  private set(next: SideChatPanelState, mainSessionId: string): void {
    this.value = { ...this.value, [mainSessionId]: next }
    for (const listener of this.listeners) listener()
  }
}
