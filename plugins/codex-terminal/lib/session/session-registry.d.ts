import type { SessionRecord } from '../types.js';
/** Owner-neutral registry for plugin-owned opaque numeric session identifiers. */
export declare class SessionRegistry {
    private readonly records;
    private nextId;
    reserve(): number;
    publish(record: SessionRecord): void;
    rollback(id: number): void;
    get(id: number): SessionRecord | undefined;
    remove(id: number): SessionRecord | undefined;
    values(): SessionRecord[];
    get size(): number;
}
//# sourceMappingURL=session-registry.d.ts.map