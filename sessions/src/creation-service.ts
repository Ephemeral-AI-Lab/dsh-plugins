import type { Context } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentHandle,
  ModelSelection,
  ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { SessionId as makeSessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { CreateSessionArgs, CreateSessionResult } from './types.js'

/**
 * Creates detached sessions from the host context and keeps their handles
 * owned by this plugin until the host disposes it.
 */
export class SessionCreationService {
  private readonly ownedHandles = new Map<string, AgentHandle>()

  constructor(private readonly ctx: Context) {}

  async createSession(
    args: CreateSessionArgs,
    parent?: Agent,
    signal?: AbortSignal,
  ): Promise<CreateSessionResult> {
    requireText(args.prompt, 'prompt')
    signal?.throwIfAborted()

    const location = await this.resolveLocation(args, parent)
    const selection = await this.resolveSelection(args.model, parent, signal)
    const preset = await this.resolvePreset(args.preset, parent)
    signal?.throwIfAborted()

    const sessionId = makeSessionId(`session-${randomUUID()}`)
    const metadata = sessionMetadata(preset?.id, location)
    const modelRef = { current: selection, assembled: undefined } satisfies ModelSelectionRef
    const setup = createSetup(preset, modelRef)
    const handle = await this.ctx.agents.create({
      sessionId,
      ...Object.keys(metadata).length === 0 ? {} : { meta: metadata },
      agentOptions: { provider: selection.provider, model: selection.model },
      ...setup === undefined ? {} : { setup },
      ...signal === undefined ? {} : { signal },
    })
    this.ownedHandles.set(String(sessionId), handle)

    try {
      signal?.throwIfAborted()
      await location.workspace?.attachSession(sessionId)
      handle.agent.followup(await userMessage(args.prompt))
    } catch (error: unknown) {
      this.ownedHandles.delete(String(sessionId))
      await handle.dispose()
      throw error
    }

    return {
      session_id: String(sessionId),
      accepted: true,
      status: 'queued',
      ...publicLocation(location),
    }
  }

  async dispose(): Promise<void> {
    const handles = [...this.ownedHandles.values()]
    this.ownedHandles.clear()
    await Promise.all(handles.map(handle => handle.dispose()))
  }

  private async resolveSelection(
    explicit: CreateSessionArgs['model'],
    parent: Agent | undefined,
    signal?: AbortSignal,
  ): Promise<ModelSelection> {
    if (explicit !== undefined) {
      requireText(explicit.provider, 'model.provider')
      requireText(explicit.model, 'model.model')
      let reasoningEffort: ReturnType<typeof ReasoningEffortId> | undefined
      if (explicit.reasoningEffort !== undefined) {
        requireText(explicit.reasoningEffort, 'model.reasoningEffort')
        reasoningEffort = ReasoningEffortId(explicit.reasoningEffort.trim())
      }
      const config: LlmCallConfig = {
        provider: explicit.provider.trim(),
        model: explicit.model.trim(),
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
      await this.ctx.get('llm')?.resolveCallConfig(config, signal)
      return {
        provider: config.provider,
        model: config.model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }

    const inherited = parent === undefined ? undefined : inheritedSelection(parent)
    if (inherited !== undefined) return inherited

    const defaultModel = this.ctx.get('agentDefaultModel')
    const selection = defaultModel?.currentSelection()
    if (selection === undefined) {
      throw new Error('session_create requires model.provider and model.model when no model default is configured')
    }
    return selection
  }

  private async resolvePreset(
    explicit: string | undefined,
    parent: Agent | undefined,
  ): Promise<{ id: string; mount: (agentCtx: Context) => Promise<void> } | undefined> {
    if (explicit !== undefined) {
      requireText(explicit, 'preset')
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) throw new Error('session_create.preset requires agent presets to be configured')
      const resolved = await presets.resolve(explicit.trim())
      if (parent !== undefined) {
        const parentPresets = parent.ctx.get('agentPresets')
        if (parentPresets?.composedPreset(parent.ctx) === resolved.id) {
          return {
            id: resolved.id,
            mount: async agentCtx => { parentPresets.composeFrom(agentCtx, parent.ctx) },
          }
        }
      }
      return {
        id: resolved.id,
        mount: async agentCtx => { await presets.mount(agentCtx, resolved.id) },
      }
    }

    if (parent !== undefined) {
      const presets = parent.ctx.get('agentPresets') ?? this.ctx.get('agentPresets')
      const id = presets?.composedPreset(parent.ctx)
      if (id !== undefined) {
        return { id, mount: async agentCtx => { presets?.composeFrom(agentCtx, parent.ctx) } }
      }

      if (presets !== undefined) {
        const resolved = await presets.resolve()
        return {
          id: resolved.id,
          mount: async agentCtx => { await presets.mount(agentCtx, resolved.id) },
        }
      }
    }

    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    const resolved = await presets.resolve()
    return {
      id: resolved.id,
      mount: async agentCtx => { await presets.mount(agentCtx, resolved.id) },
    }
  }

  private async resolveLocation(
    args: CreateSessionArgs,
    parent: Agent | undefined,
  ): Promise<SessionLocation> {
    const registry = this.ctx.get('workspaceRegistry')

    if (args.cwd !== undefined) {
      const cwd = await canonicalDirectory(args.cwd)
      const workspace = registry === undefined ? undefined : await registry.resolveByPath(cwd)
      return {
        cwd,
        ...workspace === undefined ? {} : { workspace_id: String(workspace.id) },
        ...workspace === undefined ? {} : { workspace },
      }
    }

    const inheritedCwd = parent?.session.header.cwd
    if (inheritedCwd === undefined) return {}
    const workspace = registry === undefined ? undefined : await optionalWorkspace(registry, inheritedCwd)
    return {
      cwd: inheritedCwd,
      ...workspace === undefined ? {} : { workspace_id: String(workspace.id), workspace },
    }
  }
}

interface SessionLocation {
  workspace_id?: string
  cwd?: string
  workspace?: WorkspaceReference
}

interface WorkspaceReference {
  readonly id: string
  readonly path: string
  attachSession(sessionId: ReturnType<typeof makeSessionId>): Promise<void>
}

function createSetup(
  preset: { id: string; mount: (agentCtx: Context) => Promise<void> } | undefined,
  modelRef: ModelSelectionRef | undefined,
): ((agentCtx: Context) => Promise<void>) | undefined {
  if (preset === undefined && modelRef === undefined) return undefined

  return async agentCtx => {
    if (preset !== undefined) {
      await preset.mount(agentCtx)
    }
    if (modelRef !== undefined) {
      const { installModelSelection } = await import('@deepseek-ai/dsh-agent')
      installModelSelection(agentCtx, modelRef)
    }
  }
}

function inheritedSelection(parent: Agent): ModelSelection | undefined {
  const header = parent.session.requestHeader()
  const route = header?.config
  if (header !== undefined && route?.provider !== undefined && route.model !== undefined) {
    const explicitEffort = header.adapterDefaults?.reasoningEffort === true
      ? undefined
      : route.reasoningEffort
    return {
      provider: route.provider,
      model: route.model,
      ...explicitEffort === undefined ? {} : { reasoningEffort: explicitEffort },
    }
  }
  if (parent.options.provider !== undefined && parent.options.model !== undefined) {
    return { provider: parent.options.provider, model: parent.options.model }
  }
  return undefined
}

function sessionMetadata(
  preset: string | undefined,
  location: SessionLocation,
): {
  cwd?: string
  agentPreset?: string
} {
  return {
    ...location.cwd === undefined ? {} : { cwd: location.cwd },
    ...preset === undefined ? {} : { agentPreset: preset },
  }
}

function publicLocation(location: SessionLocation): { workspace_id?: string; cwd?: string } {
  return {
    ...location.workspace_id === undefined ? {} : { workspace_id: location.workspace_id },
    ...location.cwd === undefined ? {} : { cwd: location.cwd },
  }
}

async function optionalWorkspace(
  registry: { resolveByPath(path: string): Promise<WorkspaceReference | undefined> },
  cwd: string,
): Promise<WorkspaceReference | undefined> {
  try {
    return await registry.resolveByPath(cwd)
  } catch {
    return undefined
  }
}

async function canonicalDirectory(value: string): Promise<string> {
  requireText(value, 'cwd')
  const cwd = value.trim()
  if (!isAbsolute(cwd)) throw new Error('cwd must be an absolute path')
  const canonical = await realpath(cwd)
  if (!(await stat(canonical)).isDirectory()) throw new Error(`cwd '${cwd}' is not a directory`)
  return canonical
}

async function userMessage(text: string) {
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}
