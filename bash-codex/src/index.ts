import type { Context } from '@deepseek-ai/cordis'
import { createPtyFirstFactory } from './backend/pty-backend.js'
import { createExecutionPolicy } from './policy/execution-policy.js'
import { registerExecCommandTool } from './tools/exec-command.js'
import { registerWriteStdinTool } from './tools/write-stdin.js'
import { ExecSessionService } from './session/exec-session-service.js'
import { createShellAdapter } from './shell/index.js'
import type { Config, ResolvedConfig } from './types.js'

export const name = 'bash-codex'
export const inject = ['tools', 'systemPrompt']

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
  const service = new ExecSessionService(
    resolved,
    createShellAdapter(resolved),
    createPtyFirstFactory(resolved.ptyFallback),
    policy,
  )

  ctx.effect(() => async () => {
    await service.dispose()
  }, 'bash-codex session cleanup')

  ctx.systemPrompt.section({
    name: 'tool:bash-codex',
    order: 105,
    text: 'The bash-codex command tools use the host-resolved shell; use `workdir` for the command directory. Long-running commands return an opaque session id for `write_stdin`.',
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
