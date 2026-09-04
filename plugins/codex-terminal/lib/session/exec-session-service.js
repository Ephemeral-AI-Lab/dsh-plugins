import { resolve as resolvePath } from 'node:path';
import { TextEncoder } from 'node:util';
import { normalizeOutputLimit } from '../output/output-limiter.js';
import { delay, terminateAndJoin, throwIfAborted } from './lifecycle.js';
import { OutputLog } from './output-log.js';
import { createSessionExitNotification } from './owner-notification.js';
import { SessionRegistry } from './session-registry.js';
const encoder = new TextEncoder();
export class UnknownSessionError extends Error {
    constructor(jobId) {
        super(`unknown or completed exec job ${jobId}`);
        this.name = 'UnknownSessionError';
    }
}
export class SessionOwnershipError extends Error {
    constructor(jobId) {
        super(`exec job ${jobId} belongs to a different agent owner`);
        this.name = 'SessionOwnershipError';
    }
}
export class MaxSessionsError extends Error {
    constructor(limit) {
        super(`maximum active exec sessions reached (${limit})`);
        this.name = 'MaxSessionsError';
    }
}
export class ExecSessionService {
    config;
    shellAdapter;
    backendFactory;
    policy;
    jobs;
    registry = new SessionRegistry();
    completed = new Map();
    ownerCleanup = new WeakSet();
    closedOwners = new WeakSet();
    disposed = false;
    anonymousOwner = Object.freeze({ ownerId: 'anonymous' });
    constructor(config, shellAdapter, backendFactory, policy, jobs) {
        this.config = config;
        this.shellAdapter = shellAdapter;
        this.backendFactory = backendFactory;
        this.policy = policy;
        this.jobs = jobs;
    }
    ownerFor(owner) {
        return owner === undefined ? this.anonymousOwner : owner;
    }
    async exec(request) {
        throwIfAborted(request.signal);
        if (this.disposed)
            throw new Error('codex-terminal session service is disposed');
        if (this.registry.size >= this.config.maxSessions)
            throw new MaxSessionsError(this.config.maxSessions);
        const id = this.registry.reserve();
        const startedAt = Date.now();
        let backend;
        try {
            const shell = await this.shellAdapter.resolve();
            const cwd = resolvePath(request.workdir ?? process.cwd());
            await this.policy?.authorize(request.cmd, cwd, request.signal);
            backend = await this.backendFactory({
                executable: shell.executable,
                argv: shell.oneShotArgs(request.cmd),
                cwd,
                maxOutputBytes: this.config.maxOutputBytes,
                rows: this.config.rows,
                cols: this.config.cols,
                windowsPtyStartupGraceMs: this.config.windowsPtyStartupGraceMs,
            });
            // dispose() can run while backend startup is awaiting. Never publish a
            // backend after disposal has taken its registry snapshot.
            if (this.disposed)
                throw new Error('codex-terminal session service is disposed');
            const record = this.publish(id, request.owner, backend, startedAt);
            this.installOwnerCleanup(request.owner);
            await this.collect(record, request.yieldTimeMs ?? this.config.defaultYieldTimeMs, request.signal);
            const result = await this.finishOperation(record, startedAt, request.maxOutputTokens);
            if (this.registry.get(record.id) !== undefined) {
                const jobId = this.promote(record, request.cmd, request.jobOwner);
                record.exposedToCaller = true;
                result.job_id = jobId;
                result.chunk_id = `${jobId}-${record.outputSequence}`;
            }
            return result;
        }
        catch (error) {
            if (backend !== undefined && this.registry.get(id) === undefined) {
                await this.cleanupUnpublished(backend);
            }
            else if (this.registry.get(id) !== undefined) {
                await this.abortSession(id, error);
            }
            else {
                this.registry.rollback(id);
            }
            throw error;
        }
    }
    async write(request) {
        throwIfAborted(request.signal);
        const completed = this.completed.get(request.jobId);
        if (completed !== undefined) {
            if (completed.owner !== request.owner)
                throw new SessionOwnershipError(request.jobId);
            if (request.chars.length > 0)
                throw new StdinClosedError(request.jobId);
            completed.outputSequence += 1;
            return {
                output: '',
                wall_time_seconds: 0,
                exit_code: completed.exit.exitCode ?? -1,
                chunk_id: `${request.jobId}-${completed.outputSequence}`,
                already_collected: true,
            };
        }
        const record = this.requireOwned(request.jobId, request.owner);
        const prior = record.activeOperation ?? Promise.resolve();
        const operation = prior.then(() => this.performWrite(record, request), () => this.performWrite(record, request));
        const tracked = operation.finally(() => {
            if (record.activeOperation === tracked)
                record.activeOperation = undefined;
        });
        record.activeOperation = tracked;
        return tracked;
    }
    async closeOwner(owner) {
        this.closedOwners.add(owner);
        const records = this.registry.values().filter(record => record.owner === owner);
        await Promise.all(records.map(record => this.terminateRecord(record, 'owner_disposed')));
        for (const [id, completed] of this.completed) {
            if (completed.owner === owner)
                this.completed.delete(id);
        }
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        const records = this.registry.values();
        await Promise.all(records.map(record => this.terminateRecord(record, 'service_disposed')));
        for (const record of this.registry.values())
            this.registry.remove(record.id);
        this.completed.clear();
    }
    get liveSessionCount() {
        return this.registry.size;
    }
    publish(id, owner, backend, startedAt) {
        const output = new OutputLog(this.config.maxOutputBytes);
        let record;
        const exitPromise = backend.waitForExit().then(async (exit) => {
            record.exit = exit;
            record.state = 'exited';
            // Wait for the backend's stream-drain boundary before closing the log.
            await backend.waitForQuiescence();
            output.finish();
            if (record.jobId === undefined)
                this.notifyNaturalExit(record);
            return exit;
        }).catch((error) => {
            record.failure = error;
            record.state = 'exited';
            output.finish();
            throw error;
        });
        record = {
            id,
            owner,
            backend,
            output,
            state: 'starting',
            activeOperation: undefined,
            startedAt,
            cursor: 0,
            outputSequence: 0,
            notificationAttempted: false,
            exposedToCaller: false,
            terminalReportedByTool: false,
            jobCancelRequested: false,
            outputUnsubscribe: () => undefined,
            exitPromise,
        };
        record.outputUnsubscribe = backend.onData((stream, bytes) => output.append(stream, bytes));
        this.registry.publish(record);
        record.state = 'running';
        void exitPromise.catch(() => undefined);
        return record;
    }
    async performWrite(record, request) {
        const startedAt = Date.now();
        try {
            throwIfAborted(request.signal);
            if (record.state === 'closed' || record.state === 'terminating')
                throw new UnknownSessionError(publicSessionId(record));
            if (record.exit !== undefined || record.failure !== undefined || record.state === 'exited') {
                if (record.exit !== undefined && request.chars.length > 0)
                    throw new StdinClosedError(publicSessionId(record));
                return await this.finishOperation(record, startedAt, request.maxOutputTokens);
            }
            if (request.chars.length > 0) {
                if (record.backend.transport === 'pipe' && request.chars === '\u0003') {
                    await record.backend.interrupt();
                }
                else {
                    await record.backend.write(encoder.encode(request.chars));
                }
            }
            await this.collect(record, request.yieldTimeMs ?? this.config.pollYieldTimeMs, request.signal, request.chars.length === 0);
            return await this.finishOperation(record, startedAt, request.maxOutputTokens);
        }
        catch (error) {
            // A closed stdin is a normal post-exit condition. Preserve the record so
            // an empty poll can still deliver its unread output.
            if (this.registry.get(record.id) !== undefined && !hasTerminalResult(record)) {
                await this.abortSession(record.id, error);
            }
            throw error;
        }
    }
    async collect(record, yieldTimeMs, signal, returnBufferedImmediately = false) {
        const waitMs = clampWait(yieldTimeMs);
        if (waitMs === 0 || record.exit !== undefined || record.failure !== undefined || isClosing(record))
            return;
        // Output already buffered since the previous result must be returned
        // immediately, including bytes produced between tool calls.
        if (returnBufferedImmediately && record.output.size > record.cursor)
            return;
        const deadline = Date.now() + waitMs;
        let observedCursor = record.output.size;
        while (record.exit === undefined && record.failure === undefined && !isClosing(record)) {
            throwIfAborted(signal);
            const remaining = deadline - Date.now();
            if (remaining <= 0)
                return;
            await Promise.race([
                record.output.waitForChange(observedCursor, signal),
                delay(remaining),
                record.exitPromise.catch(() => undefined),
            ]);
            observedCursor = record.output.size;
        }
    }
    async finishOperation(record, startedAt, requestedTokens) {
        if (record.exit !== undefined)
            await record.exitPromise.catch(() => undefined);
        if (record.failure !== undefined)
            throw record.failure;
        if (record.exit === undefined && isClosing(record))
            throw new UnknownSessionError(publicSessionId(record));
        if (record.exit !== undefined)
            await record.backend.waitForQuiescence();
        const limit = normalizeOutputLimit({ maxOutputTokens: requestedTokens ?? this.config.defaultMaxOutputTokens }, this.config.defaultMaxOutputTokens, this.config.maxOutputTokens);
        const read = record.output.read(record.cursor, limit);
        record.cursor = read.nextCursor;
        record.outputSequence += 1;
        const result = {
            output: read.text,
            wall_time_seconds: Math.max(0, (Date.now() - startedAt) / 1000),
            chunk_id: `${record.jobId ?? record.id}-${record.outputSequence}`,
            ...read.truncated || record.output.isTruncated ? { truncated: true } : {},
        };
        if (record.exit !== undefined) {
            result.exit_code = record.exit.exitCode ?? -1;
            record.terminalReportedByTool = true;
            if (read.hasMore) {
                if (record.jobId !== undefined)
                    result.job_id = record.jobId;
            }
            else {
                this.removeCompleted(record);
            }
        }
        else {
            if (record.jobId !== undefined)
                result.job_id = record.jobId;
        }
        return result;
    }
    requireOwned(id, owner) {
        const record = this.registry.values().find(candidate => candidate.jobId === id);
        if (record === undefined || record.state === 'closed')
            throw new UnknownSessionError(id);
        if (record.owner !== owner)
            throw new SessionOwnershipError(id);
        return record;
    }
    removeCompleted(record) {
        if (!this.disposed && record.jobId !== undefined && record.exit !== undefined && !this.closedOwners.has(record.owner)) {
            this.completed.set(record.jobId, {
                owner: record.owner,
                exit: record.exit,
                outputSequence: record.outputSequence,
            });
        }
        this.releaseRecord(record, 'collected');
    }
    async abortSession(id, originalError) {
        const record = this.registry.get(id);
        if (record === undefined)
            return;
        if (record.exit !== undefined) {
            this.releaseRecord(record, 'backend_failure');
            return;
        }
        record.state = 'terminating';
        try {
            await terminateAndJoin(record.backend);
        }
        finally {
            this.releaseRecord(record, 'backend_failure');
        }
        void originalError;
    }
    async terminateRecord(record, reason) {
        if (this.registry.get(record.id) === undefined)
            return;
        record.state = 'terminating';
        try {
            await terminateAndJoin(record.backend);
        }
        finally {
            this.releaseRecord(record, reason);
        }
    }
    releaseRecord(record, reason) {
        if (this.registry.get(record.id) === undefined)
            return;
        record.outputUnsubscribe();
        record.outputUnsubscribe = () => undefined;
        record.cleanupReason = reason;
        record.state = 'closed';
        this.registry.remove(record.id);
    }
    async cleanupUnpublished(backend) {
        await terminateAndJoin(backend).catch(() => undefined);
    }
    notifyNaturalExit(record) {
        if (this.disposed || this.closedOwners.has(record.owner))
            return;
        if (!record.exposedToCaller || record.notificationAttempted || record.exit === undefined)
            return;
        if (record.owner.steer === undefined)
            return;
        record.notificationAttempted = true;
        try {
            record.owner.steer(createSessionExitNotification(record.jobId ?? `codex-terminal-${record.id}`, record.exit));
        }
        catch {
            // Notification is advisory; the session remains pollable.
        }
    }
    promote(record, command, jobOwner) {
        const jobs = this.jobs;
        if (jobs === undefined) {
            const id = `codex-terminal-${record.id}`;
            record.jobId = id;
            void record.exitPromise.then(() => this.notifyNaturalExit(record), () => undefined);
            return id;
        }
        let settle;
        const done = new Promise((resolve) => { settle = resolve; });
        const id = jobs.start({
            kind: 'codex-terminal',
            label: command.replace(/\s+/g, ' ').trim(),
            ...jobOwner === undefined ? {} : { owner: jobOwner },
            run: () => ({
                cancel: () => {
                    if (record.jobCancelRequested)
                        return;
                    record.jobCancelRequested = true;
                    void terminateAndJoin(record.backend);
                },
                done,
            }),
        });
        record.jobId = id;
        void record.exitPromise.then(exit => this.settlePromoted(record, id, jobOwner, settle, {
            status: record.jobCancelRequested ? 'killed' : 'completed',
            detail: exit.signal === null
                ? `exit code: ${exit.exitCode ?? -1}`
                : `signal: ${exit.signal}`,
        }), error => this.settlePromoted(record, id, jobOwner, settle, {
            status: 'failed',
            detail: String(error),
        }));
        return id;
    }
    async settlePromoted(record, jobId, jobOwner, settle, outcome) {
        const activeAtExit = record.activeOperation;
        // A terminal waiter marks the generic job notice reported. Codex Shell's
        // notice points at write_stdin, while job_output intentionally owns no PTY output.
        const reported = this.jobs?.wait(jobId, 30_000, jobOwner).catch(() => undefined);
        settle(outcome);
        await reported;
        await activeAtExit?.catch(() => undefined);
        if (!record.jobCancelRequested && !record.terminalReportedByTool && record.exit !== undefined) {
            this.notifyNaturalExit(record);
        }
    }
    installOwnerCleanup(owner) {
        if (this.ownerCleanup.has(owner))
            return;
        this.ownerCleanup.add(owner);
        const maybeContext = owner.ctx;
        if (maybeContext === undefined)
            return;
        try {
            maybeContext.effect(() => async () => { await this.closeOwner(owner); }, 'codex-terminal owner session cleanup');
        }
        catch {
            // A synthetic or already-disposing owner has no effect scope; global
            // plugin disposal still owns the session and remains fail-safe.
        }
    }
}
export class StdinClosedError extends Error {
    constructor(jobId) {
        super(`exec job ${jobId} stdin is closed; poll with empty chars to collect its result`);
        this.name = 'StdinClosedError';
    }
}
function isClosing(record) {
    return record.state === 'terminating' || record.state === 'closed';
}
function hasTerminalResult(record) {
    return record.exit !== undefined;
}
function clampWait(value) {
    if (!Number.isFinite(value) || value < 0)
        return 0;
    return Math.min(30_000, Math.floor(value));
}
function publicSessionId(record) {
    return record.jobId ?? `codex-terminal-${record.id}`;
}
//# sourceMappingURL=exec-session-service.js.map