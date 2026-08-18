import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId as makeSessionId } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionSendArgs, SessionSendMode, SessionSendResult } from './types.js'

/** Sends messages to existing sessions and owns any handles resumed for delivery. */
export class SessionSendService {
  private readonly ownedHandles = new Map<SessionId, AgentHandle>()
  private readonly persistence: SessionPersistence

  constructor(private readonly ctx: Context) {
    this.persistence = ctx.sessionPersistence
  }

  async send(
    args: SessionSendArgs,
    parent?: Agent,
    signal?: AbortSignal,
  ): Promise<SessionSendResult> {
    const sessionId = toSessionId(args.session_id)
    requireText(args.message, 'message')
    const mode = validateMode(args.mode)
    signal?.throwIfAborted()

    let agent = this.ctx.agents.get(sessionId)
    let resumed: AgentHandle | undefined
    if (agent === undefined) {
      const owner = parent?.ctx ?? this.ctx
      const inspection = await this.persistence.inspect(sessionId, signal)
      const storedPreset = resolveStoredPreset(inspection.meta, inspection.events)
      const setup = await resumeComposition(owner, parent, storedPreset)
      resumed = await owner.agents.resume({
        resumeSessionId: sessionId,
        ...parent === undefined ? {} : { agentOptions: parent.options },
        ...setup === undefined ? {} : { setup },
      })
      this.ownedHandles.set(sessionId, resumed)
      agent = resumed.agent
    }

    const message = createUserMessage({
      content: [{ type: 'text', text: args.message }],
      source: { kind: 'user' },
    })
    try {
      signal?.throwIfAborted()
      if (mode === 'steer') agent.steer(message)
      else agent.followup(message)
    } catch (error: unknown) {
      if (resumed !== undefined) {
        this.ownedHandles.delete(sessionId)
        await resumed.dispose()
      }
      throw error
    }

    return { message_id: String(message.id) }
  }

  async dispose(): Promise<void> {
    const handles = [...this.ownedHandles.values()]
    this.ownedHandles.clear()
    await Promise.all(handles.map(handle => handle.dispose()))
  }
}

async function resumeComposition(
  owner: Context,
  parent: Agent | undefined,
  storedPreset: string | undefined,
): Promise<((agentCtx: Context) => Promise<void>) | undefined> {
  const ownerPresets = owner.get('agentPresets') as {
    composedPreset?(agentCtx: Context): string | undefined
    composeFrom(agentCtx: Context, parentCtx: Context): unknown
    resolve(id?: string): Promise<{ id: string }>
    mount(agentCtx: Context, id?: string): Promise<unknown>
  } | undefined

  if (parent !== undefined) {
    const parentPresets = parent.ctx.get('agentPresets') as typeof ownerPresets
    if (parentPresets !== undefined
      && parentPresets.composedPreset?.(parent.ctx) === storedPreset
      && storedPreset !== undefined) {
      return async childCtx => { parentPresets.composeFrom(childCtx, parent.ctx) }
    }
  }

  if (ownerPresets === undefined) return undefined
  const resolved = await ownerPresets.resolve(storedPreset)
  return async childCtx => { await ownerPresets.mount(childCtx, resolved.id) }
}

function resolveStoredPreset(
  header: unknown,
  events: readonly unknown[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isRecord(event) || event.type !== 'agent-preset/selected' || !isRecord(event.data)) continue
    if (typeof event.data.agentPreset === 'string') return event.data.agentPreset
  }
  return isRecord(header) && typeof header.agentPreset === 'string' ? header.agentPreset : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}

function toSessionId(value: string): SessionId {
  requireText(value, 'session_id')
  return makeSessionId(value.trim())
}

function validateMode(mode: SessionSendMode | undefined): SessionSendMode {
  if (mode === undefined) return 'steer'
  if (mode !== 'steer' && mode !== 'followup') {
    throw new Error('mode must be either steer or followup')
  }
  return mode
}
