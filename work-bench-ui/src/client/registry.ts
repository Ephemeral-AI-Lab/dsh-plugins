import type { ComponentType, ReactNode } from 'react'

export interface WorkbenchPanelProps {
  close: () => void
}

export interface WorkbenchItem {
  id: string
  label: string
  component: ComponentType<WorkbenchPanelProps>
  icon?: ReactNode
  order?: number
}

export interface WorkbenchSnapshot {
  open: boolean
  activeId: string | null
  items: readonly WorkbenchItem[]
}

export interface WorkbenchService {
  register(item: WorkbenchItem): () => void
  open(id: string): void
  close(): void
  toggle(id?: string): void
  getSnapshot(): WorkbenchSnapshot
  subscribe(listener: () => void): () => void
}

export interface WorkbenchRegistryOptions {
  onOpen?: () => void
  onClose?: () => void
}

const EMPTY: WorkbenchSnapshot = Object.freeze({
  open: false,
  activeId: null,
  items: Object.freeze([]),
})

export class WorkbenchRegistry implements WorkbenchService {
  private readonly entries = new Map<string, WorkbenchItem>()
  private readonly listeners = new Set<() => void>()
  private snapshot: WorkbenchSnapshot = EMPTY

  constructor(private readonly options: WorkbenchRegistryOptions = {}) {}

  register(item: WorkbenchItem): () => void {
    if (item.id.length === 0) throw new Error('workbench item id must not be empty')
    if (this.entries.has(item.id)) throw new Error(`workbench item already registered: ${item.id}`)
    this.entries.set(item.id, item)
    this.publish(this.snapshot.open, this.snapshot.activeId)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.entries.delete(item.id)
      const activeId = this.snapshot.activeId === item.id ? null : this.snapshot.activeId
      if (activeId === null && this.snapshot.open) this.close()
      else this.publish(this.snapshot.open, activeId)
    }
  }

  open(id: string): void {
    if (!this.entries.has(id)) return
    this.publish(true, id)
    this.options.onOpen?.()
  }

  close(): void {
    if (!this.snapshot.open) return
    this.publish(false, null)
    this.options.onClose?.()
  }

  toggle(id?: string): void {
    if (this.snapshot.open) {
      this.close()
      return
    }
    const target = id ?? this.snapshot.activeId ?? this.snapshot.items[0]?.id
    if (target === undefined) {
      this.publish(true, null)
      this.options.onOpen?.()
    }
    else this.open(target)
  }

  getSnapshot = (): WorkbenchSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(open: boolean, activeId: string | null): void {
    const items = [...this.entries.values()].sort((left, right) =>
      (left.order ?? 0) - (right.order ?? 0))
    this.snapshot = Object.freeze({ open, activeId, items: Object.freeze(items) })
    for (const listener of this.listeners) listener()
  }
}
