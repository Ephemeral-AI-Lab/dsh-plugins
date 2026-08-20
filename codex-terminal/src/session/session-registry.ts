import type { SessionRecord } from '../types.js'

/** Owner-neutral registry for plugin-owned opaque numeric session identifiers. */
export class SessionRegistry {
  private readonly records = new Map<number, SessionRecord>()
  private nextId = 1

  reserve(): number {
    while (this.records.has(this.nextId)) this.nextId += 1
    const id = this.nextId
    this.nextId += 1
    return id
  }

  publish(record: SessionRecord): void {
    if (this.records.has(record.id)) throw new Error(`session id ${record.id} is already published`)
    this.records.set(record.id, record)
  }

  rollback(id: number): void {
    this.records.delete(id)
  }

  get(id: number): SessionRecord | undefined {
    return this.records.get(id)
  }

  remove(id: number): SessionRecord | undefined {
    const record = this.records.get(id)
    this.records.delete(id)
    return record
  }

  values(): SessionRecord[] {
    return [...this.records.values()]
  }

  get size(): number {
    return this.records.size
  }
}
