import { resolve as resolvePath } from 'node:path'
import { TextEncoder } from 'node:util'
import type {
  BackendFactory,
  ExecRequest,
  ExecResult,
  ExitStatus,
  ResolvedConfig,
  SessionBackend,
  SessionOwner,
  SessionRecord,
  ShellAdapter,
  WriteRequest,
} from '../types.js'
import type { ExecutionPolicy } from '../policy/execution-policy.js'
import { normalizeOutputLimit } from '../output/output-limiter.js'
import { delay, terminateAndJoin, throwIfAborted } from './lifecycle.js'
import { OutputLog } from './output-log.js'
import { SessionRegistry } from './session-registry.js'

const encoder = new TextEncoder()

export class UnknownSessionError extends Error {
  constructor(sessionId: number) {
    super(`unknown or completed exec session ${sessionId}`)
    this.name = 'UnknownSessionError'
  }
}

export class SessionOwnershipError extends Error {
  constructor(sessionId: number) {
    super(`exec session ${sessionId} belongs to a different agent owner`)
    this.name = 'SessionOwnershipError'
  }
}

export class MaxSessionsError extends Error {
  constructor(limit: number) {
    super(`maximum active exec sessions reached (${limit})`)
    this.name = 'MaxSessionsError'
  }
}

export class ExecSessionService {
  private readonly registry = new SessionRegistry()
  private readonly ownerCleanup = new WeakSet<object>()
  private disposed = false
  private readonly anonymousOwner: SessionOwner = Object.freeze({ ownerId: 'anonymous' })

  constructor(
    private readonly config: ResolvedConfig,
    private readonly shellAdapter: ShellAdapter,
    private readonly backendFactory: BackendFactory,
    private readonly policy?: ExecutionPolicy,
  ) {}

  ownerFor(owner: object | undefined): SessionOwner {
    return owner ?? this.anonymousOwner
  }

  async exec(request: ExecRequest): Promise<ExecResult> {
    throwIfAborted(request.signal)
    if (this.disposed) throw new Error('codex-shell session service is disposed')
    if (this.registry.size >= this.config.maxSessions) throw new MaxSessionsError(this.config.maxSessions)

    const id = this.registry.reserve()
    const startedAt = Date.now()
    let backend: SessionBackend | undefined
    try {
      const shell = await this.shellAdapter.resolve()
      const cwd = resolvePath(request.workdir ?? process.cwd())
      await this.policy?.authorize(request.cmd, cwd, request.signal)
      backend = await this.backendFactory({
        executable: shell.executable,
        argv: shell.oneShotArgs(request.cmd),
        cwd,
        rows: this.config.rows,
        cols: this.config.cols,
        windowsPtyStartupGraceMs: this.config.windowsPtyStartupGraceMs,
      })
      const record = this.publish(id, request.owner, backend, startedAt)
      this.installOwnerCleanup(request.owner)
      await this.collect(record, request.yieldTimeMs ?? this.config.defaultYieldTimeMs, request.signal)
      return await this.finishOperation(record, startedAt, request.maxOutputTokens)
    } catch (error: unknown) {
      if (backend !== undefined && this.registry.get(id) === undefined) {
        await this.cleanupUnpublished(backend)
      } else if (this.registry.get(id) !== undefined) {
        await this.abortSession(id, error)
      } else {
        this.registry.rollback(id)
      }
      throw error
    }
  }

  async write(request: WriteRequest): Promise<ExecResult> {
    throwIfAborted(request.signal)
    const record = this.requireOwned(request.sessionId, request.owner)
    const prior = record.activeOperation ?? Promise.resolve()
    const operation = prior.then(
      () => this.performWrite(record, request),
      () => this.performWrite(record, request),
    )
    const tracked = operation.finally(() => {
      if (record.activeOperation === tracked) record.activeOperation = undefined
    })
    record.activeOperation = tracked
    return tracked
  }

  async closeOwner(owner: SessionOwner): Promise<void> {
    const records = this.registry.values().filter(record => record.owner === owner)
    await Promise.all(records.map(record => this.terminateRecord(record)))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const records = this.registry.values()
    await Promise.all(records.map(record => this.terminateRecord(record)))
    for (const record of this.registry.values()) this.registry.remove(record.id)
  }

  get liveSessionCount(): number {
    return this.registry.size
  }

  private publish(id: number, owner: SessionOwner, backend: SessionBackend, startedAt: number): SessionRecord {
    const output = new OutputLog(this.config.maxOutputBytes)
    let record!: SessionRecord
    const exitPromise = backend.waitForExit().then((exit: ExitStatus) => {
      record.exit = exit
      record.state = 'exited'
      output.finish()
      return exit
    }).catch((error: unknown) => {
      record.failure = error
      record.state = 'exited'
      output.finish()
      throw error
    })
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
      exitPromise,
    }
    backend.onData((stream, bytes) => output.append(stream, bytes))
    this.registry.publish(record)
    record.state = 'running'
    void exitPromise.catch(() => undefined)
    return record
  }

  private async performWrite(record: SessionRecord, request: WriteRequest): Promise<ExecResult> {
    const startedAt = Date.now()
    try {
      throwIfAborted(request.signal)
      if (record.state === 'closed' || record.state === 'terminating') throw new UnknownSessionError(record.id)
      if (request.chars.length > 0) {
        if (record.backend.transport === 'pipe' && request.chars === '\u0003') {
          await record.backend.interrupt()
        } else {
          await record.backend.write(encoder.encode(request.chars))
        }
      }
      await this.collect(record, request.yieldTimeMs ?? (request.chars.length > 0 ? this.config.pollYieldTimeMs : this.config.pollYieldTimeMs), request.signal)
      return await this.finishOperation(record, startedAt, request.maxOutputTokens)
    } catch (error: unknown) {
      if (this.registry.get(record.id) !== undefined) await this.abortSession(record.id, error)
      throw error
    }
  }

  private async collect(record: SessionRecord, yieldTimeMs: number, signal: AbortSignal): Promise<void> {
    const waitMs = clampWait(yieldTimeMs)
    if (waitMs === 0 || record.exit !== undefined || record.failure !== undefined) return
    const deadline = Date.now() + waitMs
    let observedCursor = record.output.size
    while (record.exit === undefined && record.failure === undefined) {
      throwIfAborted(signal)
      const remaining = deadline - Date.now()
      if (remaining <= 0) return
      await Promise.race([
        record.output.waitForChange(observedCursor, signal),
        delay(remaining),
        record.exitPromise.catch(() => undefined),
      ])
      observedCursor = record.output.size
    }
  }

  private async finishOperation(record: SessionRecord, startedAt: number, requestedTokens: number | undefined): Promise<ExecResult> {
    if (record.failure !== undefined) throw record.failure
    if (record.exit !== undefined) await record.backend.waitForQuiescence()
    const limit = normalizeOutputLimit(
      { maxOutputTokens: requestedTokens ?? this.config.defaultMaxOutputTokens },
      this.config.defaultMaxOutputTokens,
    )
    const read = record.output.read(record.cursor, limit)
    record.cursor = read.nextCursor
    record.outputSequence += 1
    const result: ExecResult = {
      output: read.text,
      wall_time_seconds: Math.max(0, (Date.now() - startedAt) / 1000),
      chunk_id: `${record.id}-${record.outputSequence}`,
      ...read.truncated || record.output.isTruncated ? { truncated: true } : {},
    }
    if (record.exit !== undefined) {
      result.exit_code = record.exit.exitCode ?? -1
      this.removeCompleted(record)
    } else {
      result.session_id = record.id
    }
    return result
  }

  private requireOwned(id: number, owner: SessionOwner): SessionRecord {
    const record = this.registry.get(id)
    if (record === undefined || record.state === 'closed') throw new UnknownSessionError(id)
    if (record.owner !== owner) throw new SessionOwnershipError(id)
    return record
  }

  private removeCompleted(record: SessionRecord): void {
    record.state = 'closed'
    this.registry.remove(record.id)
  }

  private async abortSession(id: number, originalError: unknown): Promise<void> {
    const record = this.registry.get(id)
    if (record === undefined) return
    record.state = 'terminating'
    try {
      await terminateAndJoin(record.backend)
    } finally {
      record.state = 'closed'
      this.registry.remove(id)
    }
    void originalError
  }

  private async terminateRecord(record: SessionRecord): Promise<void> {
    if (this.registry.get(record.id) === undefined) return
    record.state = 'terminating'
    try {
      await terminateAndJoin(record.backend)
    } finally {
      record.state = 'closed'
      this.registry.remove(record.id)
    }
  }

  private async cleanupUnpublished(backend: SessionBackend): Promise<void> {
    await terminateAndJoin(backend).catch(() => undefined)
  }

  private installOwnerCleanup(owner: SessionOwner): void {
    if (this.ownerCleanup.has(owner)) return
    this.ownerCleanup.add(owner)
    const maybeContext = (owner as { ctx?: { effect: (body: () => () => Promise<void>, label?: string) => unknown } }).ctx
    if (maybeContext === undefined) return
    try {
      maybeContext.effect(() => async () => { await this.closeOwner(owner) }, 'codex-shell owner session cleanup')
    } catch {
      // A synthetic or already-disposing owner has no effect scope; global
      // plugin disposal still owns the session and remains fail-safe.
    }
  }
}

function clampWait(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(30_000, Math.floor(value))
}
