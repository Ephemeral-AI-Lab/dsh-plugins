/** Owner-neutral registry for plugin-owned opaque numeric session identifiers. */
export class SessionRegistry {
    records = new Map();
    nextId = 1;
    reserve() {
        while (this.records.has(this.nextId))
            this.nextId += 1;
        const id = this.nextId;
        this.nextId += 1;
        return id;
    }
    publish(record) {
        if (this.records.has(record.id))
            throw new Error(`session id ${record.id} is already published`);
        this.records.set(record.id, record);
    }
    rollback(id) {
        this.records.delete(id);
    }
    get(id) {
        return this.records.get(id);
    }
    remove(id) {
        const record = this.records.get(id);
        this.records.delete(id);
        return record;
    }
    values() {
        return [...this.records.values()];
    }
    get size() {
        return this.records.size;
    }
}
//# sourceMappingURL=session-registry.js.map