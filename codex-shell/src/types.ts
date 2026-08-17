export type ExecutionMode = 'trusted' | 'host-policy'
export type PtyFallback = 'pipe' | 'error'

export interface Config {
  executionMode?: ExecutionMode
  ptyFallback?: PtyFallback
  maxSessions?: number
  defaultYieldTimeMs?: number
  pollYieldTimeMs?: number
  maxOutputBytes?: number
  defaultMaxOutputTokens?: number
  rows?: number
  cols?: number
  windowsPtyStartupGraceMs?: number
  windowsShell?: string
  posixShell?: string
}

export interface ResolvedConfig {
  executionMode: ExecutionMode
  ptyFallback: PtyFallback
  maxSessions: number
  defaultYieldTimeMs: number
  pollYieldTimeMs: number
  maxOutputBytes: number
  defaultMaxOutputTokens: number
  rows: number
  cols: number
  windowsPtyStartupGraceMs: number
  windowsShell?: string
  posixShell?: string
}

export interface ExecCommandArgs {
  cmd: string
  workdir?: string
  yield_time_ms?: number
  max_output_tokens?: number
}

export interface WriteStdinArgs {
  session_id: number
  chars?: string
  yield_time_ms?: number
  max_output_tokens?: number
}

export interface ExecResult {
  output: string
  wall_time_seconds: number
  session_id?: number
  exit_code?: number
  chunk_id?: string
  original_token_count?: number
  truncated?: boolean
}

export type OutputStream = 'pty' | 'stdout' | 'stderr'

export interface OutputLimit {
  maxOutputTokens: number
}

export interface OutputRead {
  text: string
  nextCursor: number
  originalTokenCount?: number
  truncated: boolean
  hasMore: boolean
}

export interface ExitStatus {
  exitCode: number | null
  signal: string | null
}

export interface SessionBackend {
  readonly transport: 'pty' | 'pipe'
  readonly pid: number | undefined
  onData(listener: (stream: OutputStream, data: Uint8Array) => void): () => void
  write(data: Uint8Array): Promise<void>
  closeStdin(): Promise<void>
  interrupt(): Promise<void>
  terminate(): Promise<void>
  waitForExit(): Promise<ExitStatus>
  waitForQuiescence(): Promise<void>
}

export interface BackendSpawnRequest {
  executable: string
  argv: readonly string[]
  cwd: string
  maxOutputBytes?: number
  rows: number
  cols: number
  windowsPtyStartupGraceMs: number
}

export type BackendFactory = (request: BackendSpawnRequest) => Promise<SessionBackend>

export interface SessionNotification {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
  readonly source: {
    readonly kind: 'plugin'
    readonly plugin: 'codex-shell'
    readonly form: 'notice'
    readonly summary: string
  }
}

export interface SessionOwner {
  readonly ownerId?: string
  readonly status?: 'idle' | 'running' | 'maintenance'
  readonly inject?: (message: SessionNotification) => void
  readonly followup?: (message: SessionNotification) => void
}

export interface ExecRequest {
  owner: SessionOwner
  cmd: string
  workdir?: string
  yieldTimeMs?: number
  maxOutputTokens?: number
  signal: AbortSignal
}

export interface WriteRequest {
  owner: SessionOwner
  sessionId: number
  chars: string
  yieldTimeMs?: number
  maxOutputTokens?: number
  signal: AbortSignal
}

export interface SessionRecord {
  readonly id: number
  readonly owner: SessionOwner
  readonly backend: SessionBackend
  readonly output: import('./session/output-log.js').OutputLog
  state: 'starting' | 'running' | 'exited' | 'terminating' | 'closed'
  activeOperation: Promise<unknown> | undefined
  exit?: ExitStatus
  failure?: unknown
  readonly startedAt: number
  cursor: number
  outputSequence: number
  notificationAttempted: boolean
  exposedToCaller: boolean
  outputUnsubscribe: () => void
  cleanupReason?: 'collected' | 'owner_disposed' | 'service_disposed' | 'expired' | 'backend_failure'
  readonly exitPromise: Promise<ExitStatus>
}

export interface ShellResolution {
  executable: string
  oneShotArgs(command: string): readonly string[]
  interactiveArgs(): readonly string[]
}

export interface ShellAdapter {
  resolve(): Promise<ShellResolution>
  oneShotArgs(command: string): readonly string[]
  interactiveArgs(): readonly string[]
}
