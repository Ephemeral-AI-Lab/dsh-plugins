import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';
import { LOOP_CHANGE_VERSION, } from './types.js';
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
export class LoopInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LoopInputError';
    }
}
export class LoopLogError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LoopLogError';
    }
}
export class LoopRuntimeError extends Error {
    phase;
    constructor(phase, cause) {
        super(cause instanceof Error ? cause.message : String(cause), { cause });
        this.phase = phase;
        this.name = 'LoopRuntimeError';
    }
}
export function createLoopRecord(prompt, timeInSeconds, now = Date.now(), id = `loop_${randomUUID()}`) {
    validatePrompt(prompt);
    validateTime(timeInSeconds);
    validateId(id, LoopInputError);
    if (!Number.isSafeInteger(now) || now < 0)
        throw new LoopInputError('now must be a non-negative safe integer');
    return {
        id,
        prompt: prompt.trim(),
        time_in_seconds: timeInSeconds,
        next_at: addSeconds(now, timeInSeconds),
    };
}
export function renderLoopMessage(id, prompt) {
    return [
        '<heartbeat>',
        `  <loop_id>${escapeXml(id)}</loop_id>`,
        `  <prompt>${escapeXml(prompt)}</prompt>`,
        '</heartbeat>',
    ].join('\n');
}
export function foldLoopEvents(events, seedLength = 0) {
    if (!Number.isSafeInteger(seedLength) || seedLength < 0 || seedLength > events.length) {
        throw new LoopLogError('seedLength must be a safe integer within the event log');
    }
    const active = new Map();
    const seenIds = [];
    const suffix = events.slice(seedLength);
    for (const event of suffix) {
        if (event.type !== 'loop/change')
            continue;
        applyChange(active, seenIds, event.data);
    }
    return { active: [...active.values()], seenIds };
}
export function loopView(record, now = Date.now()) {
    return {
        ...record,
        state: record.next_at <= now ? 'overdue' : 'scheduled',
        delivery_mode: 'session-local',
    };
}
export function nextOccurrence(record, now) {
    const interval = record.time_in_seconds * 1000;
    if (!Number.isSafeInteger(now) || now < record.next_at)
        return record.next_at;
    const skipped = Math.floor((now - record.next_at) / interval) + 1;
    return addMilliseconds(record.next_at, skipped * interval);
}
/** One disposable timer projection for one exact agent. */
export class LoopRuntime {
    options;
    timer;
    requested = false;
    running;
    queue = Promise.resolve();
    stopping = false;
    disposal;
    failure;
    pendingTransactions = 0;
    pausedForTransaction = false;
    constructor(options) {
        this.options = options;
    }
    get lastError() {
        return this.failure;
    }
    start() {
        this.requestDrive();
    }
    requestDrive() {
        if (this.stopping)
            return;
        this.pausedForTransaction = false;
        this.clearTimer();
        this.requested = true;
        if (this.running !== undefined)
            return;
        const run = this.enqueue(async () => {
            while (this.requested && !this.stopping) {
                this.requested = false;
                await this.driveOnce();
                if (this.pausedForTransaction)
                    break;
            }
        });
        this.running = run;
        void run.then(() => {
            this.running = undefined;
            this.failure = undefined;
        }, (reason) => {
            this.running = undefined;
            const error = reason instanceof LoopRuntimeError ? reason : new LoopRuntimeError('runtime', reason);
            this.failure = error;
            try {
                this.options.onError?.(error);
            }
            catch {
                // Error reporting cannot stop the runtime from retrying.
            }
            if (this.requested && !this.stopping)
                this.requestDrive();
        });
    }
    transact(task) {
        if (this.stopping)
            return Promise.reject(new Error('loop runtime is disposed'));
        this.pendingTransactions += 1;
        return this.enqueue(async () => {
            this.pendingTransactions -= 1;
            try {
                return await task();
            }
            finally {
                if (this.pausedForTransaction && !this.stopping)
                    this.requestDrive();
            }
        });
    }
    dispose() {
        return (this.disposal ??= (async () => {
            this.stopping = true;
            this.requested = false;
            this.clearTimer();
            await Promise.allSettled([this.queue]);
        })());
    }
    enqueue(task) {
        const result = this.queue.then(task);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
    async driveOnce() {
        if (!this.isLive())
            return;
        try {
            await flushPersistence(this.options.ctx, this.options.agent);
        }
        catch (error) {
            throw new LoopRuntimeError('initial-flush', error);
        }
        if (!this.isLive())
            return;
        if (this.pendingTransactions !== 0) {
            this.pausedForTransaction = true;
            return;
        }
        const folded = foldLoopEvents(this.options.agent.session.events, this.options.agent.session.header.seedLength ?? 0);
        const now = Date.now();
        const due = folded.active
            .filter(loop => loop.next_at <= now)
            .sort((left, right) => left.next_at - right.next_at)[0];
        if (due === undefined) {
            const next = folded.active
                .map(loop => loop.next_at)
                .sort((left, right) => left - right)[0];
            if (next !== undefined)
                this.arm(next, now);
            return;
        }
        const message = createUserMessage({
            content: [{ type: 'text', text: renderLoopMessage(due.id, due.prompt) }],
            source: { kind: 'plugin', plugin: 'loop' },
        });
        const target = this.options.agent.status === 'running' ? 'next-step' : 'next-turn';
        if (!this.isLive())
            return;
        try {
            this.options.agent.send(message, target, true);
        }
        catch (error) {
            throw new LoopRuntimeError('send', error);
        }
        try {
            this.options.agent.session.append('loop/change', {
                version: LOOP_CHANGE_VERSION,
                operation: 'dispatch',
                id: due.id,
                next_at: nextOccurrence(due, now),
            });
        }
        catch (error) {
            throw new LoopRuntimeError('dispatch-append', error);
        }
        try {
            await flushPersistence(this.options.ctx, this.options.agent);
        }
        catch (error) {
            throw new LoopRuntimeError('post-dispatch-flush', error);
        }
        this.requestDrive();
    }
    arm(target, now) {
        this.clearTimer();
        const delay = Math.max(0, Math.min(target - now, MAX_TIMER_DELAY_MS));
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.requestDrive();
        }, delay);
    }
    clearTimer() {
        if (this.timer === undefined)
            return;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
    isLive() {
        return !this.stopping && this.options.ctx.agents.get(this.options.agent.id) === this.options.agent;
    }
}
export async function flushPersistence(ctx, agent) {
    if (!await ctx.sessions.flush(agent.session)) {
        throw new Error('Loop persistence did not complete');
    }
}
export function applyLoopChange(state, change) {
    const active = new Map(state.map(loop => [loop.id, loop]));
    applyChange(active, [...active.keys()], change);
    return [...active.values()];
}
function applyChange(active, seenIds, rawChange) {
    const change = parseLoopChange(rawChange);
    if (change.operation === 'create') {
        const loop = normalizeRecord(change.loop);
        if (seenIds.includes(loop.id))
            throw new LoopLogError(`duplicate loop id: ${loop.id}`);
        seenIds.push(loop.id);
        active.set(loop.id, loop);
        return;
    }
    if (change.operation === 'delete') {
        validateId(change.id, LoopLogError);
        if (!active.delete(change.id))
            throw new LoopLogError(`cannot delete inactive loop: ${change.id}`);
        return;
    }
    if (change.operation === 'update') {
        const current = active.get(change.loop.id);
        if (current === undefined)
            throw new LoopLogError(`cannot update inactive loop: ${change.loop.id}`);
        const loop = normalizeRecord(change.loop);
        active.set(loop.id, loop);
        return;
    }
    const loop = active.get(change.id);
    if (loop === undefined)
        throw new LoopLogError(`cannot dispatch inactive loop: ${change.id}`);
    if (!Number.isSafeInteger(change.next_at) || change.next_at <= loop.next_at) {
        throw new LoopLogError(`invalid next_at for loop: ${change.id}`);
    }
    active.set(change.id, { ...loop, next_at: change.next_at });
}
function parseLoopChange(value) {
    if (!isRecord(value) || value.version !== LOOP_CHANGE_VERSION || typeof value.operation !== 'string') {
        throw new LoopLogError('unsupported loop change version or shape');
    }
    switch (value.operation) {
        case 'create':
        case 'update':
            if (!('loop' in value))
                throw new LoopLogError(`loop ${value.operation} is missing its record`);
            return value;
        case 'delete':
            if (!('id' in value))
                throw new LoopLogError('loop delete is missing its id');
            return value;
        case 'dispatch':
            if (!('id' in value) || !('next_at' in value))
                throw new LoopLogError('loop dispatch is missing its fields');
            return value;
        default:
            throw new LoopLogError(`unknown loop change operation: ${value.operation}`);
    }
}
function normalizeRecord(record) {
    if (!isRecord(record))
        throw new LoopLogError('loop record must be an object');
    const allowed = new Set(['id', 'prompt', 'time_in_seconds', 'next_at', 'title', 'allow_steer']);
    if (Object.keys(record).some(key => !allowed.has(key)))
        throw new LoopLogError('loop record contains unknown fields');
    if (record.title !== undefined && typeof record.title !== 'string')
        throw new LoopLogError('legacy loop title must be a string');
    if (record.allow_steer !== undefined && typeof record.allow_steer !== 'boolean')
        throw new LoopLogError('legacy loop allow_steer must be boolean');
    const { title: _title, allow_steer: _allowSteer, ...normalized } = record;
    validateRecord(normalized);
    return normalized;
}
function validateRecord(record) {
    validateId(record.id, LoopLogError);
    if (typeof record.prompt !== 'string' || record.prompt.trim().length === 0) {
        throw new LoopLogError('loop prompt must be non-empty');
    }
    if (typeof record.time_in_seconds !== 'number')
        throw new LoopLogError('time_in_seconds must be a positive safe integer');
    validateLogTime(record.time_in_seconds);
    if (typeof record.next_at !== 'number' || !Number.isSafeInteger(record.next_at) || record.next_at < 0) {
        throw new LoopLogError('loop next_at must be a non-negative safe integer');
    }
}
function validateId(id, ErrorType) {
    if (typeof id !== 'string' || id.trim() !== id || id.length === 0) {
        throw new ErrorType('loop id must be a non-empty string without surrounding whitespace');
    }
}
function validatePrompt(prompt) {
    if (typeof prompt !== 'string' || prompt.trim().length === 0)
        throw new LoopInputError('prompt must be non-empty');
}
function validateTime(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0)
        throw new LoopInputError('time_in_seconds must be a positive safe integer');
}
function validateLogTime(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0)
        throw new LoopLogError('time_in_seconds must be a positive safe integer');
}
function addSeconds(now, seconds) {
    return addMilliseconds(now, seconds * 1000);
}
function addMilliseconds(now, milliseconds) {
    const result = now + milliseconds;
    if (!Number.isSafeInteger(result))
        throw new LoopInputError('loop time is outside the safe date range');
    return result;
}
function escapeXml(value) {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=loop.js.map