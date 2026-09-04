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
  validateMockScript,
  type MockScript,
  type MockScriptError,
} from './converter.js'
import {
  MockCommandParseError,
  parseMockCommand,
} from './parser.js'
import {
  MockAdapter,
  type MockAdapterEvent,
  type MockUiState,
} from './mock-adapter.js'
import { mockStatusProjectionDefinition } from './projection.js'
import { readReplayInput } from './replay-input.js'

export const name = 'mock'
export const inject = ['llm', 'commands']

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Ephemeral mock status for the host's compact status-row bridge. */
    'mock/status'(state: MockUiState): void
  }
}

/**
 * Install the external mock provider and the per-turn command/request hooks.
 * The hooks are public AgentLoop extension points; the loop and ToolRuntime
 * remain the only code that executes, validates, authorizes, or records tools.
 */
export function apply(ctx: Context): void {
  const uiStates = new Map<string, MockUiState>()
  const mockRouteUsed = new Set<string>()
  const mockTurns = new Map<string, number>()
  const realRoutes = new Map<string, LlmCallConfig>()
  // Keep the configured route available for auxiliary calls (compaction and
  // session-title) that can outlive the AgentLoop instance which issued the
  // mock turn. The key remains the session id, so no session can borrow
  // another session's real provider.
  const routeHistory = new Map<string, LlmCallConfig>()
  const sessions = new Map<string, Session>()
  const latestRunIds = new Map<string, string>()
  const watchedAbortSignals = new WeakSet<AbortSignal>()

  function latestPersistedMockState(session: Session): MockUiState | undefined {
    for (const event of [...session.events].reverse()) {
      if (event.type === 'mock/status') return event.data
    }
    return undefined
  }

  function publishMockState(state: MockUiState): boolean {
    const sessionId = state.sessionId
    const latestRunId = latestRunIds.get(sessionId)
    if (latestRunId !== undefined && latestRunId !== state.runId) return false
    latestRunIds.set(sessionId, state.runId)
    uiStates.set(sessionId, state)
    sessions.get(sessionId)?.append('mock/status', state)
    ctx.emit('mock/status', state)
    return true
  }

  function reconcilePersistedState(session: Session): void {
    const sessionId = String(session.id)
    sessions.set(sessionId, session)
    const persisted = latestPersistedMockState(session)
    if (persisted === undefined
      || !isLiveMockPhase(persisted.phase)
      || adapterPlanExists(sessionId)) return
    latestRunIds.set(sessionId, persisted.runId)
    publishMockState({
      ...persisted,
      phase: 'cancelled',
      errorCode: 'STALE_REPLAY',
      errorMessage: 'Mock replay stopped after reload; no live run was restored.',
    })
  }

  function adapterPlanExists(sessionId: string): boolean {
    return adapter.getPlanState(sessionId) !== undefined
  }

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(mockStatusProjectionDefinition)
  })
  const adapter = new MockAdapter((event: MockAdapterEvent) => {
    if (event.kind === 'state') {
      publishMockState(event.state)
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
        ?? (options.provider === 'mock' ? undefined : { provider: options.provider, model: options.model })
    if (options.purpose === undefined && sessionId !== undefined && mockTurns.has(sessionId)) return undefined
    if (route === undefined || route.provider === 'mock') return undefined
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

  const registration = ctx.llm.registerAdapter(['mock'], adapter)
  const commandRegistration = ctx.commands.register({
    name: 'mock',
    description: 'Run a deterministic tool call or replay script',
    input: { hint: 'run <tool(JSON)> | replay <path> [--overwrite-wait-time-ms N]' },
    handler: (invocation: CommandInvocation) => {
      const command = createUserMessage({
        content: [{ type: 'text', text: `/mock${invocation.rawInput}` }],
        source: { kind: 'user' },
      })
      invocation.agent.followup(command)
      return { kind: 'success', text: 'Mock command queued.' }
    },
  })

  ctx.on('agent/pre-step', async (payload: {
    readonly agent: Agent
    readonly messages: UserMessage[]
    readonly turn: number
    readonly step: number
    readonly signal: AbortSignal
  }, next: () => Promise<PreStepDecision>) => {
    const commandMessage = findMockCommand(payload.messages)
    if (commandMessage === undefined) return next()
    const sessionId = String(payload.agent.id)
    sessions.set(sessionId, payload.agent.session)
    reconcilePersistedState(payload.agent.session)
    const runId = `mock-${cryptoRandomId()}`
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
      mockRouteUsed.add(sessionId)
      mockTurns.set(sessionId, payload.turn)
      return next()
    } catch (error: unknown) {
      if (payload.signal.aborted) return { kind: 'reject' }
      const diagnostic = mockDiagnostic(error)
      const state: MockUiState = {
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
      publishMockState(state)
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
    if (adapter.getPlanState(sessionId) !== undefined || mockRouteUsed.has(sessionId)) {
      const runId = adapter.getPlanState(sessionId)?.runId
      if (runId !== undefined) watchReplayCancellation(sessionId, signal, runId)
    }
    const config = await next()
    if (config.provider !== 'mock') routeHistory.set(sessionId, config)
    const mockTurn = mockTurns.get(sessionId)
    if (adapter.getPlanState(sessionId) !== undefined || (mockRouteUsed.has(sessionId) && mockTurn === turn)) {
      if (!realRoutes.has(sessionId) && config.provider !== 'mock') realRoutes.set(sessionId, config)
      // The selected real model's reasoning effort is not meaningful for the
      // deterministic adapter. Omitting it also prevents the host LLM
      // contract from asking a no-thinking mock model to produce reasoning.
      const { reasoningEffort: _reasoningEffort, ...mockConfig } = config
      return { ...mockConfig, provider: 'mock', model: 'mock' }
    }

    // AgentLoop persists the last request header. Restore the configured real
    // route on the first ordinary turn after a mock turn, without mutating
    // Agent.options or the model-page selection.
    const route = realRoutes.get(sessionId)
      ?? (agent.options.provider === undefined || agent.options.model === undefined
        ? undefined
        : { provider: agent.options.provider, model: agent.options.model })
    if (mockRouteUsed.has(sessionId) && route !== undefined) {
      mockRouteUsed.delete(sessionId)
      mockTurns.delete(sessionId)
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
    if (mockTurns.get(sessionId) === turn) adapter.clearSession(sessionId)
  })

  ctx.on('agent/disposed', ({ agent }: { readonly agent: Agent }) => {
    const sessionId = String(agent.id)
    adapter.clearSession(sessionId)
    mockRouteUsed.delete(sessionId)
    mockTurns.delete(sessionId)
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
    mockRouteUsed.clear()
    mockTurns.clear()
    realRoutes.clear()
    routeHistory.clear()
    sessions.clear()
    latestRunIds.clear()
  }, 'mock cleanup')
}

function isLiveMockPhase(phase: MockUiState['phase']): boolean {
  return phase === 'queued' || phase === 'running' || phase === 'waiting'
}

interface PreparedCommand {
  readonly mode: 'run' | 'replay'
  readonly script: MockScript
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
  const command = parseMockCommand(text)
  if (command.kind === 'run') {
    const script = validateMockScript({
      type: 'dsh-mock-script',
      version: 1,
      steps: [command.calls.length === 1
        ? { tool: command.calls[0]!.name, args: command.calls[0]!.arguments }
        : { parallel: command.calls.map(call => ({ tool: call.name, args: call.arguments })) }],
    })
    return { mode: 'run', script }
  }

  const sourcePath = resolveReplayPath(agent.session.header.cwd, command.path)
  const source = await readReplayInput(sourcePath, signal)
  if (signal?.aborted) throw signal.reason ?? new Error('mock command aborted')
  const script = await convertReplaySource(source, sourcePath)
  return {
    mode: 'replay',
    script,
    ...(command.overwriteWaitTimeMs === undefined ? {} : { overwriteWaitTimeMs: command.overwriteWaitTimeMs }),
    sourcePath,
  }
}

async function convertReplaySource(source: string, sourcePath: string): Promise<MockScript> {
  const trimmed = source.replace(/^\uFEFF/, '').trimStart()
  if (trimmed.length === 0) throw new Error(`${sourcePath}: source file is empty`)
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isRecord(parsed) && parsed.type === 'dsh-mock-script') return parseCanonicalScript(trimmed, sourcePath)
    if (isRecord(parsed) && parsed.type === 'session') return convertDshJsonl(trimmed, sourcePath)
    throw new Error(`${sourcePath}: JSON is neither canonical dsh-mock-script JSON nor DSH JSONL`)
  } catch (error: unknown) {
    if (error instanceof Error && (error as MockScriptError).code !== undefined) throw error
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

function rejectNestedReplay(script: MockScript, mode: 'run' | 'replay'): void {
  if (mode !== 'replay') return
  const names = script.steps.flatMap(step => 'parallel' in step ? step.parallel.map(member => member.tool) : 'tool' in step ? [step.tool] : [])
  const unsupported = names.find(name => /(?:^|[-_])(nested|subagent|agent[-_]spawn|spawn[-_]agent)(?:$|[-_])/i.test(name))
  if (unsupported !== undefined) throw new Error(`UNSUPPORTED_NESTED_TOOL: replay does not support nested/subagent tool ${unsupported}`)
}

function findMockCommand(messages: readonly UserMessage[]): CommandMessage | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (!text.startsWith('/mock')) continue
    let mode: 'run' | 'replay' = 'run'
    try {
      const parsed = parseMockCommand(text)
      mode = parsed.kind
    } catch {
      const match = /^\/mock\s+(run|replay)(?:\s|$)/.exec(text)
      if (match?.[1] === 'replay') mode = 'replay'
    }
    return { text, mode }
  }
  return undefined
}

function mockDiagnostic(error: unknown): { readonly code: string; readonly message: string; readonly sourcePath?: string } {
  if (error instanceof MockCommandParseError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    const candidate = error as MockScriptError
    const prefixedCode = /^(UNSUPPORTED_NESTED_TOOL|INVALID_SCRIPT|CONVERSION_MISMATCH):/.exec(error.message)?.[1]
    return {
      code: prefixedCode ?? (typeof candidate.code === 'string' ? candidate.code : 'INVALID_SCRIPT'),
      message: error.message,
      ...(candidate.path === undefined ? {} : { sourcePath: candidate.path }),
    }
  }
  return { code: 'INVALID_SCRIPT', message: 'mock script could not be prepared' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cryptoRandomId(): string {
  return randomUUID()
}

export { MockAdapter } from './mock-adapter.js'
export { executableStepCount, formatMockStatus } from './mock-adapter.js'
export type { MockAdapterEvent, MockPlanOptions, MockRunMode, MockRunPhase, MockUiState } from './mock-adapter.js'
export {
  MockScriptError,
  DshJsonlConversionError,
  compileMockScript,
  convertDshJsonl,
  parseCanonicalScript,
  serializeMockScript,
  validateMockScript,
} from './converter.js'
export type {
  CompiledMockScript,
  CompiledMockStep,
  MockDelayStep,
  MockParallelStep,
  MockScript,
  MockScriptErrorCode,
  MockScriptStep,
  MockToolStep,
  MockWaitStep,
} from './converter.js'
export {
  MockCommandParseError,
  isMockToolName,
  parseMockCommand,
  parseReplayCommand,
  parseRunCommand,
  parseToolCall,
} from './parser.js'
export type { MockReplayCommand, MockRunCommand, ParsedMockCommand, ParsedToolCall } from './parser.js'
