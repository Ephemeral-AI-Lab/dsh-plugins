import { randomUUID } from 'node:crypto'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmFailure,
  LlmResolvedModelInfo,
  Message,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  compileDebugScript,
  type CompiledDebugScript,
  type DebugParallelStep,
  type DebugScript,
  type DebugToolStep,
} from './converter.js'
import { DebugCommandParseError, parseDebugCommand, parseToolCall } from './parser.js'
import type { DebugRunMode, DebugRunPhase, DebugUiState } from './types.js'

const MODEL = 'debug'

export type { DebugRunMode, DebugRunPhase, DebugUiState } from './types.js'

export interface DebugPlanOptions {
  readonly sessionId: string
  readonly runId?: string
  readonly mode: DebugRunMode
  readonly script: DebugScript
  readonly overwriteWaitTimeMs?: number
  readonly sourcePath?: string
}

/** UI bridge helper: waits and implicit gaps never enter the denominator. */
export function executableStepCount(script: DebugScript): number {
  return compileDebugScript(script).executableStepCount
}

/** Compact generic label for the transient status row described by ui-ux.md. */
export function formatDebugStatus(state: DebugUiState): string {
  const noun = state.mode === 'replay' ? 'Debug replay' : 'Debug run'
  switch (state.phase) {
    case 'queued':
    case 'running':
    case 'waiting':
      return `${noun} - ${state.currentStep}/${state.totalSteps}`
    case 'failed':
      return `${noun} stopped - ${state.errorCode ?? 'ERROR'}`
    case 'completed':
      return `${noun} completed`
    case 'cancelled':
      return `${noun} cancelled`
  }
}

export interface DebugToolResultInfo {
  readonly isError: boolean
  readonly code?: string
}

export type DebugAdapterEvent =
  | { readonly kind: 'state'; readonly state: DebugUiState }
  | { readonly kind: 'disposed'; readonly sessionId: string; readonly runId: string }

type BackgroundStream = (options: GenerateOptions) => AsyncIterable<StreamChunk> | undefined

interface PendingCall {
  readonly callId: CallId
  readonly name: string
}

interface DebugPlan {
  readonly sessionId: string
  readonly runId: string
  readonly mode: DebugRunMode
  readonly compiled: CompiledDebugScript
  readonly sourcePath?: string
  readonly pendingResults: Map<string, DebugToolResultInfo>
  readonly activeWaits: Set<AbortController>
  readonly abortController: AbortController
  readonly seenMessageIds: Set<string>
  currentExecutableIndex: number
  pendingCalls: PendingCall[]
  phase: DebugRunPhase
  terminal: boolean
  protocolError?: string
  historyInitialized: boolean
}

/**
 * Deterministic model output for the real AgentLoop.
 *
 * This class only emits `StreamChunk`s. Tool lookup, argument validation,
 * policy, approval, execution, result rendering, and durable events remain in
 * the host AgentLoop/ToolRuntime pipeline.
 */
export class MockDebugAdapter extends LlmAdapter {
  private readonly plans = new Map<string, DebugPlan>()
  private readonly retiredCallIds = new Map<string, Set<string>>()
  private readonly signalPlans = new WeakMap<AbortSignal, DebugPlan>()
  private readonly activeSignals = new Set<AbortController>()
  private readonly onEvent: ((event: DebugAdapterEvent) => void) | undefined
  private readonly backgroundStream: BackgroundStream | undefined
  private disposed = false

  constructor(onEvent?: (event: DebugAdapterEvent) => void, backgroundStream?: BackgroundStream) {
    super()
    this.onEvent = onEvent
    this.backgroundStream = backgroundStream
  }

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'Mock Debug' }
  }

  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    if (signal?.aborted) return Promise.reject(abortError())
    return Promise.resolve({
      provider,
      id: model,
      name: model === MODEL ? 'Deterministic Debug Model' : model,
      inputModalities: ['text'],
    })
  }

  get pendingSessionCount(): number {
    return this.plans.size
  }

  get pendingWaitCount(): number {
    let count = 0
    for (const plan of this.plans.values()) count += plan.activeWaits.size
    return count
  }

  /** Expose a detached snapshot for tests and host UI bridges. */
  getPlanState(sessionId: string): DebugUiState | undefined {
    const plan = this.plans.get(sessionId)
    return plan === undefined ? undefined : stateFor(plan)
  }

  /** Start one validated, session-scoped plan. */
  startPlan(options: DebugPlanOptions): DebugUiState {
    if (this.disposed) throw new Error('debug adapter is disposed')
    if (options.sessionId.length === 0) throw new Error('debug plan requires a sessionId')
    this.clearSession(options.sessionId)
    const compiled = compileDebugScript(options.script, options.overwriteWaitTimeMs)
    const plan: DebugPlan = {
      sessionId: options.sessionId,
      runId: options.runId ?? `debug-${randomUUID()}`,
      mode: options.mode,
      compiled,
      ...(options.sourcePath === undefined ? {} : { sourcePath: options.sourcePath }),
      pendingResults: new Map(),
      activeWaits: new Set(),
      abortController: new AbortController(),
      seenMessageIds: new Set(),
      currentExecutableIndex: 0,
      pendingCalls: [],
      phase: 'queued',
      terminal: false,
      historyInitialized: false,
    }
    this.plans.set(options.sessionId, plan)
    this.publish(plan)
    return stateFor(plan)
  }

  /** Record the real ToolRuntime result associated with one emitted call. */
  noteToolResult(sessionId: string, callId: string, result: DebugToolResultInfo, toolCallId = callId): void {
    const plan = this.plans.get(sessionId)
    if (plan === undefined) {
      // A result delivered on the wrong session must wake the session that is
      // actually waiting for it; otherwise that plan can wait forever for an
      // ID that was already delivered elsewhere.
      const owner = this.findPlanWithPendingCall(callId)
      if (owner !== undefined) {
        this.markProtocolError(owner, `cross-session tool result ${callId} was reported for ${sessionId}; expected ${owner.sessionId}`)
      }
      return
    }
    if (plan.terminal) return
    if (this.retiredCallIds.get(sessionId)?.has(callId)) return
    const pending = plan.pendingCalls.find(call => String(call.callId) === callId)
    if (pending === undefined) {
      const owner = this.findPlanWithPendingCall(callId)
      if (owner !== undefined && owner !== plan) {
        this.markProtocolError(owner, `cross-session tool result ${callId} was reported for ${sessionId}; expected ${owner.sessionId}`)
      }
      this.markProtocolError(plan, `unexpected tool result ${callId} for session ${sessionId}`)
      return
    }
    if (toolCallId !== callId) {
      this.markProtocolError(plan, `tool result ${callId} is correlated to ${toolCallId}, expected ${callId}`)
      return
    }
    if (plan.pendingResults.has(callId)) {
      this.markProtocolError(plan, `duplicate tool result for ${callId}`)
      return
    }
    plan.pendingResults.set(callId, result)
    if (result.isError) this.publish(plan, result.code ?? 'TOOL_ERROR', 'The real tool runtime reported an error.')
  }

  private findPlanWithPendingCall(callId: string): DebugPlan | undefined {
    for (const plan of this.plans.values()) {
      if (!plan.terminal && plan.pendingCalls.some(call => String(call.callId) === callId)) return plan
    }
    return undefined
  }

  /** Clear one session; stale results can never advance another plan. */
  clearSession(sessionId: string, expectedRunId?: string): void {
    const plan = this.plans.get(sessionId)
    if (plan === undefined) return
    if (expectedRunId !== undefined && plan.runId !== expectedRunId) return
    const retired = this.retiredCallIds.get(sessionId) ?? new Set<string>()
    for (const call of plan.pendingCalls) retired.add(String(call.callId))
    if (retired.size > 0) this.retiredCallIds.set(sessionId, retired)
    plan.phase = 'cancelled'
    plan.terminal = true
    plan.abortController.abort('debug plan cleared')
    for (const controller of plan.activeWaits) controller.abort('debug plan cleared')
    plan.activeWaits.clear()
    this.publish(plan, 'CANCELLED', 'Debug run cancelled.')
    if (this.plans.get(sessionId) === plan) this.plans.delete(sessionId)
    this.onEvent?.({ kind: 'disposed', sessionId, runId: plan.runId })
  }

  /** Release all adapter-owned plans, waits, and abort listeners. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.activeSignals) controller.abort('debug adapter disposed')
    this.activeSignals.clear()
    for (const sessionId of [...this.plans.keys()]) this.clearSession(sessionId)
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    if (this.disposed) {
      yield abortedChunk('debug adapter disposed')
      return
    }
    if (sessionId === undefined || sessionId.length === 0) {
      yield errorChunk('debug requests require a sessionId', 'DEBUG_SESSION_REQUIRED')
      return
    }
    if (options.signal?.aborted) {
      const owner = this.signalPlans.get(options.signal)
      if (owner !== undefined && this.plans.get(sessionId) === owner) this.clearSession(sessionId, owner.runId)
      yield abortedChunk()
      return
    }

    // Session titles and compaction are auxiliary model calls. They can run
    // while a real replay tool is still executing, but they must never enter
    // the replay cursor or wait on its pending tool result. Route them back to
    // the configured real provider when available; otherwise finish quietly.
    if (options.purpose !== undefined) {
      const fallback = this.backgroundStream?.(options)
      if (fallback !== undefined) {
        yield* fallback
      } else {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      return
    }

    let plan = this.plans.get(sessionId)
    if (plan === undefined) {
      // Include plugin-sourced user messages here: compaction adds its
      // instruction as the final user-role message, after the original slash
      // command. The direct-plan fallback below remains user-source-only.
      const input = latestUserMessageText(options.messages)
      if (!isDebugLikeInput(input) && this.backgroundStream !== undefined) {
        const fallback = this.backgroundStream?.(options)
        if (fallback !== undefined) {
          yield* fallback
          return
        }
        // A terminal debug turn can leave a host maintenance step with the
        // internal route header before it is restored. End that auxiliary
        // step quietly instead of leaking the real provider or surfacing a
        // synthetic DEBUG_PLAN_MISSING error in the user's transcript.
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      plan = this.createDirectPlan(options, sessionId)
      if (plan === undefined) {
        const input = latestUserText(options.messages)
        if (input !== undefined) {
          try {
            if (input.startsWith('/debug')) parseDebugCommand(input)
            else parseToolCall(input)
          } catch (error: unknown) {
            const message = error instanceof DebugCommandParseError ? error.message : 'invalid debug command'
            yield* textResponse(`Invalid debug command: ${message}`)
            return
          }
        }
        yield errorChunk('no active debug plan for this session', 'DEBUG_PLAN_MISSING')
        return
      }
    }
    if (plan.terminal) {
      yield errorChunk('debug plan is already terminal', 'DEBUG_PLAN_TERMINAL')
      return
    }
    if (options.signal !== undefined) this.signalPlans.set(options.signal, plan)

    try {
      if (options.signal?.aborted) throw abortError()
      if (plan.protocolError !== undefined) {
        yield* this.finishWithError(plan, plan.protocolError, 'DEBUG_PROTOCOL')
        return
      }
      if (!plan.historyInitialized) {
        rememberToolMessages(plan, options.messages)
        plan.historyInitialized = true
      }
      if (plan.pendingCalls.length > 0) {
        let result = collectExpectedResults(options.messages, plan.pendingCalls, plan.pendingResults, plan.seenMessageIds)
        if (result.kind === 'protocol-error') {
          yield* this.finishWithError(plan, result.message, 'DEBUG_PROTOCOL')
          return
        }
        if (result.missing.length > 0) {
          // A ToolRuntime result is durable before the next request is
          // derived, but public session/event delivery may be queued behind
          // that boundary. Wait for the per-session event handoff to finish;
          // a real tool may legitimately run longer than any fixed timeout.
          await this.waitForReportedResults(plan, result.missing, options.signal)
          const retried = collectExpectedResults(options.messages, plan.pendingCalls, plan.pendingResults, plan.seenMessageIds)
          if (retried.kind === 'protocol-error') {
            yield* this.finishWithError(plan, retried.message, 'DEBUG_PROTOCOL')
            return
          }
          if (retried.missing.length > 0) {
            yield* this.finishWithError(plan, `missing tool result for ${retried.missing.join(', ')}`, 'DEBUG_PROTOCOL')
            return
          }
          result = retried
        }
        rememberToolMessages(plan, options.messages)
        plan.pendingCalls = []
        plan.pendingResults.clear()
        if (result.results.some(item => item.isError)) {
          const error = result.results.find(item => item.isError)
          const noun = plan.mode === 'replay' ? 'Debug replay' : 'Debug run'
          yield* this.finishWithError(plan, `${noun} stopped after a real tool error.`, error?.code ?? 'TOOL_ERROR')
          return
        }
        plan.currentExecutableIndex += 1
        if (plan.currentExecutableIndex >= plan.compiled.steps.length) {
          yield* this.finishSuccess(plan)
          return
        }
      }

      if (plan.currentExecutableIndex >= plan.compiled.steps.length) {
        yield* this.finishSuccess(plan)
        return
      }

      const executable = plan.compiled.steps[plan.currentExecutableIndex]
      if (executable === undefined) {
        yield* this.finishWithError(plan, 'debug queue cursor is out of range', 'DEBUG_PROTOCOL')
        return
      }
      if (executable.waitBefore > 0) {
        plan.phase = 'waiting'
        this.publish(plan)
        await this.delay(executable.waitBefore, options.signal, plan)
        plan.phase = 'running'
        this.publish(plan)
      } else {
        plan.phase = 'running'
        this.publish(plan)
      }
      yield* this.emitExecutableStep(plan, executable.step, options.signal)
    } catch (error: unknown) {
      if (plan.protocolError !== undefined) {
        yield* this.finishWithError(plan, plan.protocolError, 'DEBUG_PROTOCOL')
        return
      }
      if (isAbort(error) || options.signal?.aborted || this.disposed) {
        this.finishCancelled(plan)
        yield abortedChunk()
        return
      }
      yield* this.finishWithError(plan, error instanceof Error ? error.message : 'debug adapter failed', 'DEBUG_PROTOCOL')
    }
  }

  private createDirectPlan(options: GenerateOptions, sessionId: string): DebugPlan | undefined {
    const input = latestUserText(options.messages)
    if (input === undefined) return undefined
    try {
      const command = input.startsWith('/debug') ? parseDebugCommand(input) : { kind: 'run' as const, calls: [parseToolCall(input)] }
      if (command.kind !== 'run') return undefined
      const script: DebugScript = {
        type: 'dsh-debug-script',
        version: 1,
        steps: [command.calls.length === 1
          ? { tool: command.calls[0]!.name, args: command.calls[0]!.arguments }
          : { parallel: command.calls.map(call => ({ tool: call.name, args: call.arguments })) }],
      }
      this.startPlan({ sessionId, mode: 'run', script })
      return this.plans.get(sessionId)
    } catch (error: unknown) {
      if (error instanceof DebugCommandParseError) return undefined
      return undefined
    }
  }

  private async *emitExecutableStep(plan: DebugPlan, step: DebugToolStep | DebugParallelStep, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const calls = 'parallel' in step ? step.parallel : [step]
    plan.pendingCalls = calls.map((call, index) => ({
      callId: CallId(`debug-${plan.runId}-${plan.currentExecutableIndex}-${index}-${randomUUID()}`),
      name: call.tool,
    }))
    plan.phase = 'running'
    this.publish(plan)
    for (const [index, call] of calls.entries()) {
      if (signal?.aborted || this.disposed) throw abortError()
      const pending = plan.pendingCalls[index]
      if (pending === undefined) throw new Error('debug call allocation failed')
      yield { type: 'block-start', index, blockType: 'tool-call' }
      if (signal?.aborted || this.disposed) throw abortError()
      yield {
        type: 'block-end',
        index,
        block: {
          type: 'tool-call',
          id: pending.callId,
          name: call.tool,
          arguments: JSON.stringify(call.args),
        },
      }
    }
    if (signal?.aborted || this.disposed) throw abortError()
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }

  private async delay(milliseconds: number, signal: AbortSignal | undefined, plan: DebugPlan): Promise<void> {
    if (milliseconds <= 0) return
    const controller = new AbortController()
    this.activeSignals.add(controller)
    plan.activeWaits.add(controller)
    const onAbort = (): void => controller.abort(signal?.reason ?? 'debug wait aborted')
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds)
        const abort = (): void => {
          clearTimeout(timer)
          reject(abortError())
        }
        controller.signal.addEventListener('abort', abort, { once: true })
      })
    } finally {
      signal?.removeEventListener('abort', onAbort)
      plan.activeWaits.delete(controller)
      this.activeSignals.delete(controller)
    }
  }

  private async waitForReportedResults(plan: DebugPlan, missing: readonly string[], signal?: AbortSignal): Promise<void> {
    plan.phase = 'waiting'
    this.publish(plan)
    const controller = new AbortController()
    this.activeSignals.add(controller)
    plan.activeWaits.add(controller)
    const abortFromRequest = (): void => controller.abort(signal?.reason ?? 'debug wait aborted')
    const abortFromPlan = (): void => controller.abort(plan.abortController.signal.reason ?? 'debug plan aborted')
    signal?.addEventListener('abort', abortFromRequest, { once: true })
    plan.abortController.signal.addEventListener('abort', abortFromPlan, { once: true })
    try {
      while (missing.some(callId => !plan.pendingResults.has(callId))) {
        if (controller.signal.aborted || this.disposed) throw abortError()
        await new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined
          const cleanup = (): void => {
            if (timer !== undefined) clearTimeout(timer)
            timer = undefined
            controller.signal.removeEventListener('abort', abort)
          }
          const complete = (): void => {
            cleanup()
            resolve()
          }
          const abort = (): void => {
            cleanup()
            reject(abortError())
          }
          timer = setTimeout(complete, 10)
          controller.signal.addEventListener('abort', abort, { once: true })
          if (controller.signal.aborted) abort()
        })
      }
      if (plan.protocolError !== undefined) throw new Error(plan.protocolError)
      plan.phase = 'running'
      this.publish(plan)
    } finally {
      signal?.removeEventListener('abort', abortFromRequest)
      plan.abortController.signal.removeEventListener('abort', abortFromPlan)
      plan.activeWaits.delete(controller)
      this.activeSignals.delete(controller)
    }
  }

  private *finishSuccess(plan: DebugPlan): Iterable<StreamChunk> {
    if (plan.terminal || !this.isCurrentPlan(plan)) return
    plan.phase = 'completed'
    plan.terminal = true
    this.publish(plan)
    yield* textResponse(`${plan.mode === 'replay' ? 'Debug replay' : 'Debug run'} completed (${plan.compiled.executableStepCount} executable step${plan.compiled.executableStepCount === 1 ? '' : 's'}).`)
    this.removePlan(plan)
  }

  private *finishWithError(plan: DebugPlan, message: string, code: string): Iterable<StreamChunk> {
    if (plan.terminal || !this.isCurrentPlan(plan)) return
    plan.phase = 'failed'
    plan.terminal = true
    this.publish(plan, code, message)
    yield errorChunk(message, code)
    this.removePlan(plan)
  }

  private finishCancelled(plan: DebugPlan): void {
    if (plan.terminal || !this.isCurrentPlan(plan)) return
    plan.phase = 'cancelled'
    plan.terminal = true
    this.publish(plan, 'CANCELLED', 'Debug run cancelled.')
    this.removePlan(plan)
  }

  private markProtocolError(plan: DebugPlan, message: string): void {
    if (plan.terminal || !this.isCurrentPlan(plan) || plan.protocolError !== undefined) return
    plan.protocolError = message
    plan.abortController.abort('debug protocol error')
    for (const controller of plan.activeWaits) controller.abort('debug protocol error')
  }

  private isCurrentPlan(plan: DebugPlan): boolean {
    return this.plans.get(plan.sessionId) === plan
  }

  private removePlan(plan: DebugPlan): void {
    plan.abortController.abort('debug plan terminal')
    for (const controller of plan.activeWaits) controller.abort('debug plan terminal')
    plan.activeWaits.clear()
    if (this.plans.get(plan.sessionId) !== plan) return
    this.plans.delete(plan.sessionId)
    this.onEvent?.({ kind: 'disposed', sessionId: plan.sessionId, runId: plan.runId })
  }

  private publish(plan: DebugPlan, errorCode?: string, errorMessage?: string): void {
    if (!this.isCurrentPlan(plan)) return
    this.onEvent?.({
      kind: 'state',
      state: {
        ...stateFor(plan),
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(errorMessage === undefined ? {} : { errorMessage }),
      },
    })
  }

}

function stateFor(plan: DebugPlan): DebugUiState {
  return {
    sessionId: plan.sessionId,
    runId: plan.runId,
    mode: plan.mode,
    phase: plan.phase,
    currentStep: plan.compiled.executableStepCount === 0
      ? 0
      : Math.min(plan.currentExecutableIndex + (plan.pendingCalls.length > 0 ? 1 : 0), plan.compiled.executableStepCount),
    totalSteps: plan.compiled.executableStepCount,
    ...(plan.sourcePath === undefined ? {} : { sourcePath: plan.sourcePath }),
  }

}

function latestUserText(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'user' || message.source.kind !== 'user') continue
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length > 0) return text
  }
  return undefined
}

function latestUserMessageText(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'user') continue
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length > 0) return text
  }
  return undefined
}

function isDebugLikeInput(input: string | undefined): boolean {
  if (input === undefined) return false
  if (input.startsWith('/debug')) return true
  try {
    parseToolCall(input)
    return true
  } catch {
    return false
  }
}

type CollectedResults =
  | { readonly kind: 'ok'; readonly results: readonly DebugToolResultInfo[]; readonly missing: readonly string[] }
  | { readonly kind: 'protocol-error'; readonly message: string }

function collectExpectedResults(
  messages: Message[],
  expected: readonly PendingCall[],
  reported: ReadonlyMap<string, DebugToolResultInfo>,
  historicalMessageIds: ReadonlySet<string>,
): CollectedResults {
  const expectedIds = new Set(expected.map(call => String(call.callId)))
  const results = new Map<string, DebugToolResultInfo>()
  for (const message of messages) {
    if (message.role !== 'user' || message.source.kind !== 'tool') continue
    if (historicalMessageIds.has(String(message.id))) continue
    const sourceCallId = String(message.source.callId)
    const block = message.content.find(candidate => candidate.type === 'tool-result')
    if (block?.type !== 'tool-result') continue
    if (String(block.toolCallId) !== sourceCallId) {
      return { kind: 'protocol-error', message: `tool result ${sourceCallId} is correlated to ${String(block.toolCallId)}` }
    }
    if (!expectedIds.has(sourceCallId)) {
      return { kind: 'protocol-error', message: `unexpected tool result ${sourceCallId}` }
    }
    if (results.has(sourceCallId)) return { kind: 'protocol-error', message: `duplicate tool result for ${sourceCallId}` }
    results.set(sourceCallId, reported.get(sourceCallId) ?? { isError: block.isError === true })
  }
  // The session/event hook observes the durable ToolRuntime result before the
  // next model request is derived. Treat that per-session report as
  // authoritative even if the adapter receives the projected message a tick
  // later; this closes the public event-to-adapter handoff race without
  // manufacturing a result or executing a tool here.
  for (const call of expected) {
    const callId = String(call.callId)
    const result = reported.get(callId)
    if (result !== undefined) results.set(callId, result)
  }
  const missing = expected.filter(call => !results.has(String(call.callId))).map(call => String(call.callId))
  return { kind: 'ok', results: [...results.values()], missing }
}

function rememberToolMessages(plan: DebugPlan, messages: Message[]): void {
  for (const message of messages) {
    if (message.role === 'user' && message.source.kind === 'tool') plan.seenMessageIds.add(String(message.id))
  }
}

function textResponse(text: string): Iterable<StreamChunk> {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function errorChunk(message: string, code: string): StreamChunk {
  const failure: LlmFailure = { message, code }
  return { type: 'finish', reason: { kind: 'error', failure } }
}

function abortedChunk(message = 'debug request aborted'): StreamChunk {
  const failure: LlmFailure = { message, code: 'ABORTED' }
  return { type: 'finish', reason: { kind: 'aborted', failure } }
}

function abortError(): Error {
  const error = new Error('debug request aborted')
  error.name = 'AbortError'
  return error
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
