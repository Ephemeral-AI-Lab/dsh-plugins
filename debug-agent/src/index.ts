import { isAbsolute, normalize, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { LlmCallConfig, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  convertDshJsonl,
  parseCanonicalScript,
  validateDebugScript,
  type DebugScript,
  type DebugScriptError,
} from './converter.js'
import {
  DebugCommandParseError,
  parseDebugCommand,
} from './parser.js'
import {
  MockDebugAdapter,
  type DebugAdapterEvent,
  type DebugUiState,
} from './mock-adapter.js'
import { debugStatusProjectionDefinition } from './projection.js'
import { readReplayInput } from './replay-input.js'

export const name = 'debug-agent'
export const inject = ['llm', 'commands']

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Ephemeral debug status for the host's compact status-row bridge. */
    'debug/status'(state: DebugUiState): void
  }
}

/**
 * Install the external debug provider and the per-turn command/request hooks.
 * The hooks are public AgentLoop extension points; the loop and ToolRuntime
 * remain the only code that executes, validates, authorizes, or records tools.
 */
export function apply(ctx: Context): void {
  const uiStates = new Map<string, DebugUiState>()
  const debugRouteUsed = new Set<string>()
  const debugTurns = new Map<string, number>()
  const realRoutes = new Map<string, LlmCallConfig>()
  // Keep the configured route available for auxiliary calls (compaction and
  // session-title) that can outlive the AgentLoop instance which issued the
  // debug turn. The key remains the session id, so no session can borrow
  // another session's real provider.
  const routeHistory = new Map<string, LlmCallConfig>()
  const sessions = new Map<string, Session>()
  const latestRunIds = new Map<string, string>()
  const watchedAbortSignals = new WeakSet<AbortSignal>()

  function latestPersistedDebugState(session: Session): DebugUiState | undefined {
    for (const event of [...session.events].reverse()) {
      if (event.type === 'debug/status') return event.data
    }
    return undefined
  }

  function publishDebugState(state: DebugUiState): boolean {
    const sessionId = state.sessionId
    const latestRunId = latestRunIds.get(sessionId)
    if (latestRunId !== undefined && latestRunId !== state.runId) return false
    latestRunIds.set(sessionId, state.runId)
    uiStates.set(sessionId, state)
    sessions.get(sessionId)?.append('debug/status', state)
    ctx.emit('debug/status', state)
    return true
  }

  function reconcilePersistedState(session: Session): void {
    const sessionId = String(session.id)
    sessions.set(sessionId, session)
    const persisted = latestPersistedDebugState(session)
    if (persisted === undefined
      || !isLiveDebugPhase(persisted.phase)
      || adapterPlanExists(sessionId)) return
    latestRunIds.set(sessionId, persisted.runId)
    publishDebugState({
      ...persisted,
      phase: 'cancelled',
      errorCode: 'STALE_REPLAY',
      errorMessage: 'Debug replay stopped after reload; no live run was restored.',
    })
  }

  function adapterPlanExists(sessionId: string): boolean {
    return adapter.getPlanState(sessionId) !== undefined
  }

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(debugStatusProjectionDefinition)
  })
  const adapter = new MockDebugAdapter((event: DebugAdapterEvent) => {
    if (event.kind === 'state') {
      publishDebugState(event.state)
      return
    }
    const current = uiStates.get(event.sessionId)
    if (current?.runId === event.runId && (current.phase === 'completed' || current.phase === 'failed' || current.phase === 'cancelled')) {
      // The host can remove the active row as soon as it sees the terminal
      // state. Keeping the last snapshot here makes diagnostics/test bridges
      // able to explain the terminal result without retaining adapter state.
      uiStates.set(event.sessionId, current)
    }
  }, (options) => {
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    const route = sessionId === undefined
      ? undefined
      : realRoutes.get(sessionId)
        ?? routeHistory.get(sessionId)
        ?? (options.provider === 'mock-debug' ? undefined : { provider: options.provider, model: options.model })
    if (options.purpose === undefined && sessionId !== undefined && debugTurns.has(sessionId)) return undefined
    if (route === undefined || route.provider === 'mock-debug') return undefined
    return ctx.llm.stream({ ...options, ...route, provider: route.provider, model: route.model })
  })

  /** Tie the lifetime of a replay plan to the AgentLoop turn that owns it. */
  function watchReplayCancellation(sessionId: string, signal: AbortSignal, runId: string): void {
    if (watchedAbortSignals.has(signal)) return
    watchedAbortSignals.add(signal)
    const clear = (): void => adapter.clearSession(sessionId, runId)
    signal.addEventListener('abort', clear, { once: true })
    if (signal.aborted) clear()
  }

  const registration = ctx.llm.registerAdapter(['mock-debug'], adapter)
  const commandRegistration = ctx.commands.register({
    name: 'debug',
    description: 'Run a deterministic tool call or replay script',
    input: { hint: 'run <tool(JSON)> | replay <path> [--overwrite-wait-time-ms N]' },
    handler: (invocation: CommandInvocation) => {
      const command = createUserMessage({
        content: [{ type: 'text', text: `/debug${invocation.rawInput}` }],
        source: { kind: 'user' },
      })
      invocation.agent.followup(command)
      return { kind: 'success', text: 'Debug command queued.' }
    },
  })

  ctx.on('agent/pre-step', async (payload: {
    readonly agent: Agent
    readonly messages: UserMessage[]
    readonly turn: number
    readonly step: number
    readonly signal: AbortSignal
  }, next: () => Promise<PreStepDecision>) => {
    const commandMessage = findDebugCommand(payload.messages)
    if (commandMessage === undefined) return next()
    const sessionId = String(payload.agent.id)
    sessions.set(sessionId, payload.agent.session)
    reconcilePersistedState(payload.agent.session)
    const runId = `debug-${cryptoRandomId()}`
    latestRunIds.set(sessionId, runId)
    watchReplayCancellation(sessionId, payload.signal, runId)
    if (payload.signal.aborted) {
      adapter.clearSession(sessionId, runId)
      return { kind: 'reject' }
    }
    try {
      const prepared = await prepareCommand(payload.agent, commandMessage.text, payload.signal)
      if (payload.signal.aborted) {
        adapter.clearSession(sessionId, runId)
        return { kind: 'reject' }
      }
      rejectNestedReplay(prepared.script, prepared.mode)
      adapter.startPlan({
        sessionId,
        runId,
        mode: prepared.mode,
        script: prepared.script,
        ...(prepared.overwriteWaitTimeMs === undefined ? {} : { overwriteWaitTimeMs: prepared.overwriteWaitTimeMs }),
        ...(prepared.sourcePath === undefined ? {} : { sourcePath: prepared.sourcePath }),
      })
      debugRouteUsed.add(sessionId)
      debugTurns.set(sessionId, payload.turn)
      return next()
    } catch (error: unknown) {
      if (payload.signal.aborted) return { kind: 'reject' }
      const diagnostic = debugDiagnostic(error)
      const state: DebugUiState = {
        sessionId,
        runId,
        mode: commandMessage.mode,
        phase: 'failed',
        currentStep: 0,
        totalSteps: 0,
        errorCode: diagnostic.code,
        errorMessage: diagnostic.message,
        ...(diagnostic.sourcePath === undefined ? {} : { sourcePath: diagnostic.sourcePath }),
      }
      publishDebugState(state)
      return { kind: 'reject' as const }
    }
  })

  ctx.on('session/created', (session: Session) => {
    reconcilePersistedState(session)
  })

  ctx.on('agent/request', async ({ agent, turn, signal }: {
    readonly agent: Agent
    readonly turn: number
    readonly signal: AbortSignal
  }, next: () => Promise<LlmCallConfig>) => {
    const sessionId = String(agent.id)
    if (adapter.getPlanState(sessionId) !== undefined || debugRouteUsed.has(sessionId)) {
      const runId = adapter.getPlanState(sessionId)?.runId
      if (runId !== undefined) watchReplayCancellation(sessionId, signal, runId)
    }
    const config = await next()
    if (config.provider !== 'mock-debug') routeHistory.set(sessionId, config)
    const debugTurn = debugTurns.get(sessionId)
    if (adapter.getPlanState(sessionId) !== undefined || (debugRouteUsed.has(sessionId) && debugTurn === turn)) {
      if (!realRoutes.has(sessionId) && config.provider !== 'mock-debug') realRoutes.set(sessionId, config)
      // The selected real model's reasoning effort is not meaningful for the
      // deterministic adapter. Omitting it also prevents the host LLM
      // contract from asking a no-thinking debug model to produce reasoning.
      const { reasoningEffort: _reasoningEffort, ...debugConfig } = config
      return { ...debugConfig, provider: 'mock-debug', model: 'debug' }
    }

    // AgentLoop persists the last request header. Restore the configured real
    // route on the first ordinary turn after a debug turn, without mutating
    // Agent.options or the model-page selection.
    const route = realRoutes.get(sessionId)
      ?? (agent.options.provider === undefined || agent.options.model === undefined
        ? undefined
        : { provider: agent.options.provider, model: agent.options.model })
    if (debugRouteUsed.has(sessionId) && route !== undefined) {
      debugRouteUsed.delete(sessionId)
      debugTurns.delete(sessionId)
      realRoutes.delete(sessionId)
      const restored: LlmCallConfig = {
        ...config,
        ...route,
      }
      return restored
    }
    return config
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'tool/result') return
    const block = event.data.message.content.find(candidate => candidate.type === 'tool-result')
    if (block?.type !== 'tool-result') return
    adapter.noteToolResult(String(session.id), String(event.data.message.source.callId), {
      isError: block.isError === true,
      ...(event.data.error?.code === undefined ? {} : { code: event.data.error.code }),
    }, String(block.toolCallId))
  })

  ctx.on('agent/error', ({ agent, turn }: { readonly agent: Agent; readonly turn: number }) => {
    const sessionId = String(agent.id)
    if (debugTurns.get(sessionId) === turn) adapter.clearSession(sessionId)
  })

  ctx.on('agent/disposed', ({ agent }: { readonly agent: Agent }) => {
    const sessionId = String(agent.id)
    adapter.clearSession(sessionId)
    debugRouteUsed.delete(sessionId)
    debugTurns.delete(sessionId)
    realRoutes.delete(sessionId)
    uiStates.delete(sessionId)
    latestRunIds.delete(sessionId)
  })

  ctx.on('session/disposed', (session: Session) => {
    const sessionId = String(session.id)
    sessions.delete(sessionId)
    routeHistory.delete(sessionId)
    latestRunIds.delete(sessionId)
    uiStates.delete(sessionId)
  })

  ctx.effect(() => () => {
    adapter.dispose()
    commandRegistration()
    registration()
    uiStates.clear()
    debugRouteUsed.clear()
    debugTurns.clear()
    realRoutes.clear()
    routeHistory.clear()
    sessions.clear()
    latestRunIds.clear()
  }, 'debug-agent cleanup')
}

function isLiveDebugPhase(phase: DebugUiState['phase']): boolean {
  return phase === 'queued' || phase === 'running' || phase === 'waiting'
}

interface PreparedCommand {
  readonly mode: 'run' | 'replay'
  readonly script: DebugScript
  readonly overwriteWaitTimeMs?: number
  readonly sourcePath?: string
}

interface CommandMessage {
  readonly text: string
  readonly mode: 'run' | 'replay'
}

async function prepareCommand(
  agent: { readonly session: { readonly header: { readonly cwd?: string } } },
  text: string,
  signal?: AbortSignal,
): Promise<PreparedCommand> {
  const command = parseDebugCommand(text)
  if (command.kind === 'run') {
    const script = validateDebugScript({
      type: 'dsh-debug-script',
      version: 1,
      steps: [command.calls.length === 1
        ? { tool: command.calls[0]!.name, args: command.calls[0]!.arguments }
        : { parallel: command.calls.map(call => ({ tool: call.name, args: call.arguments })) }],
    })
    return { mode: 'run', script }
  }

  const sourcePath = resolveReplayPath(agent.session.header.cwd, command.path)
  const source = await readReplayInput(sourcePath, signal)
  if (signal?.aborted) throw signal.reason ?? new Error('debug command aborted')
  const script = await convertReplaySource(source, sourcePath)
  return {
    mode: 'replay',
    script,
    ...(command.overwriteWaitTimeMs === undefined ? {} : { overwriteWaitTimeMs: command.overwriteWaitTimeMs }),
    sourcePath,
  }
}

async function convertReplaySource(source: string, sourcePath: string): Promise<DebugScript> {
  const trimmed = source.replace(/^\uFEFF/, '').trimStart()
  if (trimmed.length === 0) throw new Error(`${sourcePath}: source file is empty`)
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isRecord(parsed) && parsed.type === 'dsh-debug-script') return parseCanonicalScript(trimmed, sourcePath)
    if (isRecord(parsed) && parsed.type === 'session') return convertDshJsonl(trimmed, sourcePath)
    throw new Error(`${sourcePath}: JSON is neither canonical dsh-debug-script JSON nor DSH JSONL`)
  } catch (error: unknown) {
    if (error instanceof Error && (error as DebugScriptError).code !== undefined) throw error
    // JSONL is intentionally attempted only after canonical JSON detection.
    // A malformed canonical object gets the clearer canonical error above.
    try {
      return convertDshJsonl(source, sourcePath)
    } catch (conversionError: unknown) {
      if (conversionError instanceof Error) throw conversionError
      throw new Error(`${sourcePath}: unable to convert replay source`)
    }
  }
}

function resolveReplayPath(cwd: string | undefined, requested: string): string {
  if (isAbsolute(requested)) return normalize(requested)
  if (cwd === undefined || cwd.length === 0) {
    throw new Error('INVALID_SCRIPT: relative replay paths require the session working directory')
  }
  return resolve(cwd, requested)
}

function rejectNestedReplay(script: DebugScript, mode: 'run' | 'replay'): void {
  if (mode !== 'replay') return
  const names = script.steps.flatMap(step => 'parallel' in step ? step.parallel.map(member => member.tool) : 'tool' in step ? [step.tool] : [])
  const unsupported = names.find(name => /(?:^|[-_])(nested|subagent|agent[-_]spawn|spawn[-_]agent)(?:$|[-_])/i.test(name))
  if (unsupported !== undefined) throw new Error(`UNSUPPORTED_NESTED_TOOL: replay does not support nested/subagent tool ${unsupported}`)
}

function findDebugCommand(messages: readonly UserMessage[]): CommandMessage | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (!text.startsWith('/debug')) continue
    let mode: 'run' | 'replay' = 'run'
    try {
      const parsed = parseDebugCommand(text)
      mode = parsed.kind
    } catch {
      const match = /^\/debug\s+(run|replay)(?:\s|$)/.exec(text)
      if (match?.[1] === 'replay') mode = 'replay'
    }
    return { text, mode }
  }
  return undefined
}

function debugDiagnostic(error: unknown): { readonly code: string; readonly message: string; readonly sourcePath?: string } {
  if (error instanceof DebugCommandParseError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    const candidate = error as DebugScriptError
    const prefixedCode = /^(UNSUPPORTED_NESTED_TOOL|INVALID_SCRIPT|CONVERSION_MISMATCH):/.exec(error.message)?.[1]
    return {
      code: prefixedCode ?? (typeof candidate.code === 'string' ? candidate.code : 'INVALID_SCRIPT'),
      message: error.message,
      ...(candidate.path === undefined ? {} : { sourcePath: candidate.path }),
    }
  }
  return { code: 'INVALID_SCRIPT', message: 'debug script could not be prepared' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cryptoRandomId(): string {
  return randomUUID()
}

export { MockDebugAdapter } from './mock-adapter.js'
export { executableStepCount, formatDebugStatus } from './mock-adapter.js'
export type { DebugAdapterEvent, DebugPlanOptions, DebugRunMode, DebugRunPhase, DebugUiState } from './mock-adapter.js'
export {
  DebugScriptError,
  DshJsonlConversionError,
  compileDebugScript,
  convertDshJsonl,
  parseCanonicalScript,
  serializeDebugScript,
  validateDebugScript,
} from './converter.js'
export type {
  CompiledDebugScript,
  CompiledDebugStep,
  DebugDelayStep,
  DebugParallelStep,
  DebugScript,
  DebugScriptErrorCode,
  DebugScriptStep,
  DebugToolStep,
  DebugWaitStep,
} from './converter.js'
export {
  DebugCommandParseError,
  isDebugToolName,
  parseDebugCommand,
  parseReplayCommand,
  parseRunCommand,
  parseToolCall,
} from './parser.js'
export type { DebugReplayCommand, DebugRunCommand, ParsedDebugCommand, ParsedToolCall } from './parser.js'
