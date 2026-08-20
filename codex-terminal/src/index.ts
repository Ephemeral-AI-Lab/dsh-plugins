import type { Context } from '@deepseek-ai/cordis'
import { createPipeBackend } from './backend/pipe-backend.js'
import { createExecutionPolicy } from './policy/execution-policy.js'
import { registerExecCommandTool } from './tools/exec-command.js'
import { registerWriteStdinTool } from './tools/write-stdin.js'
import { ExecSessionService } from './session/exec-session-service.js'
import { createShellAdapter } from './shell/index.js'
import type { BackgroundJobs, Config, ResolvedConfig } from './types.js'

export const name = 'codex-terminal'
export const inject = ['tools', 'systemPrompt', 'jobs']

const DEFAULTS: Required<Pick<ResolvedConfig,
  'executionMode' | 'ptyFallback' | 'maxSessions' | 'defaultYieldTimeMs' |
  'pollYieldTimeMs' | 'maxOutputBytes' | 'defaultMaxOutputTokens' | 'rows' | 'cols' |
  'windowsPtyStartupGraceMs'>> = {
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 64,
  defaultYieldTimeMs: 10_000,
  pollYieldTimeMs: 250,
  maxOutputBytes: 1_048_576,
  defaultMaxOutputTokens: 10_000,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const policy = createExecutionPolicy(resolved.executionMode)
  const jobs = ctx.get('jobs') as unknown as BackgroundJobs | undefined
  if (jobs === undefined) {
    throw new Error('codex-terminal: background jobs unavailable; load @deepseek-ai/dsh-jobs-local and @deepseek-ai/dsh-tool-jobs')
  }
  const service = new ExecSessionService(
    resolved,
    createShellAdapter(resolved),
    // Ordinary commands use redirected pipes. This keeps exec_command fast
    // while preserving a persistent stdin for write_stdin.
    createPipeBackend,
    policy,
    jobs,
  )

  ctx.effect(() => async () => {
    await service.dispose()
  }, 'codex-terminal session cleanup')

  ctx.systemPrompt.section({
    name: 'tool:codex-terminal',
    order: 105,
    text: 'The codex-terminal command tools use the host-resolved shell; use `workdir` for the command directory. A command that exceeds `yield_time_ms` is automatically tracked and returns one job id. Use that same id with `job_list`, `job_kill`, and `write_stdin`; only `write_stdin` with empty `chars` collects unread terminal output. Do not use `job_output` for codex-terminal jobs.',
  })

  registerExecCommandTool(ctx, service)
  registerWriteStdinTool(ctx, service)
}

export { ExecSessionService } from './session/exec-session-service.js'
export { OutputLog } from './session/output-log.js'
export { SessionRegistry } from './session/session-registry.js'
export { createPtyFirstFactory } from './backend/pty-backend.js'
export { createPipeBackend } from './backend/pipe-backend.js'
export { createNodePtyBackend } from './backend/node-pty-backend.js'
export { PosixShellAdapter } from './shell/posix-shell.js'
export { WindowsPowerShellAdapter } from './shell/windows-powershell.js'
export type * from './types.js'

function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    executionMode: config.executionMode ?? DEFAULTS.executionMode,
    ptyFallback: config.ptyFallback ?? DEFAULTS.ptyFallback,
    maxSessions: config.maxSessions ?? DEFAULTS.maxSessions,
    defaultYieldTimeMs: config.defaultYieldTimeMs ?? DEFAULTS.defaultYieldTimeMs,
    pollYieldTimeMs: config.pollYieldTimeMs ?? DEFAULTS.pollYieldTimeMs,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULTS.maxOutputBytes,
    defaultMaxOutputTokens: config.defaultMaxOutputTokens ?? DEFAULTS.defaultMaxOutputTokens,
    rows: config.rows ?? DEFAULTS.rows,
    cols: config.cols ?? DEFAULTS.cols,
    windowsPtyStartupGraceMs: config.windowsPtyStartupGraceMs ?? DEFAULTS.windowsPtyStartupGraceMs,
    ...config.windowsShell === undefined ? {} : { windowsShell: config.windowsShell },
    ...config.posixShell === undefined ? {} : { posixShell: config.posixShell },
  }
  if (resolved.executionMode !== 'trusted' && resolved.executionMode !== 'host-policy') {
    throw new Error('executionMode must be trusted or host-policy')
  }
  if (resolved.ptyFallback !== 'pipe' && resolved.ptyFallback !== 'error') {
    throw new Error('ptyFallback must be pipe or error')
  }
  for (const [name, value] of [
    ['maxSessions', resolved.maxSessions],
    ['defaultYieldTimeMs', resolved.defaultYieldTimeMs],
    ['pollYieldTimeMs', resolved.pollYieldTimeMs],
    ['maxOutputBytes', resolved.maxOutputBytes],
    ['defaultMaxOutputTokens', resolved.defaultMaxOutputTokens],
    ['rows', resolved.rows],
    ['cols', resolved.cols],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  }
  if (!Number.isSafeInteger(resolved.windowsPtyStartupGraceMs) || resolved.windowsPtyStartupGraceMs < 0) {
    throw new Error('windowsPtyStartupGraceMs must be a non-negative safe integer')
  }
  return resolved
}
