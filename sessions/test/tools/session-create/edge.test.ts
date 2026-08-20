import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { SessionCreationService } from '../../../src/creation-service.js'
import { registerSessionCreateTool } from '../../../src/tools/session-create.js'

type Tool = {
  name: string
  parameters: any
  execute(args: any, exec: { agent?: unknown; signal: AbortSignal }): Promise<any>
}

type FixtureOptions = {
  hasDefault?: boolean
  defaultSelection?: { provider: string; model: string } | null
  resolveCallConfig?: ReturnType<typeof vi.fn>
  workspace?: { id: string; path: string; attachSession: ReturnType<typeof vi.fn> }
  resolveWorkspace?: ReturnType<typeof vi.fn>
  create?: ReturnType<typeof vi.fn>
}

function makeFixture(options: FixtureOptions = {}) {
  const handle = {
    agent: { followup: vi.fn() },
    dispose: vi.fn(async () => {}),
  }
  const resolveCallConfig = options.resolveCallConfig ?? vi.fn(async (config: unknown) => config)
  const agents = {
    create: options.create ?? vi.fn(async () => handle),
  }
  const workspace = options.workspace
  const resolveWorkspace = options.resolveWorkspace ?? vi.fn(async () => workspace)
  const ctx = {
    agents,
    get(name: string) {
      if (name === 'llm') return { resolveCallConfig }
      if (name === 'agentDefaultModel' && options.hasDefault !== false) {
        return {
          currentSelection: () => Object.prototype.hasOwnProperty.call(options, 'defaultSelection')
            ? options.defaultSelection ?? undefined
            : { provider: 'default-provider', model: 'default-model' },
        }
      }
      if (name === 'workspaceRegistry' && workspace !== undefined) {
        return { resolveByPath: resolveWorkspace }
      }
      return undefined
    },
  }
  const service = new SessionCreationService(ctx as never)
  const tool = registerTool(service)
  return { agents, ctx, handle, resolveCallConfig, resolveWorkspace, service, tool, workspace }
}

function registerTool(service: { createSession: (...args: any[]) => Promise<any> }): Tool {
  let tool: Tool | undefined
  registerSessionCreateTool({
    tools: {
      register(definition: Tool) {
        tool = definition
        return () => {}
      },
    },
  } as never, service as never)
  if (tool === undefined) throw new Error('session_create was not registered')
  return tool
}

function invoke(tool: Tool, args: any, exec: { agent?: unknown; signal?: AbortSignal } = {}) {
  return tool.execute(args, {
    agent: exec.agent,
    signal: exec.signal ?? new AbortController().signal,
  })
}

const cwd = process.cwd()

describe('session_create tool edge cases — EASY (30)', () => {
  it('registers with the session_create name', () => {
    expect(makeFixture().tool.name).toBe('session_create')
  })

  it('requires prompt in the parameter schema', () => {
    expect(makeFixture().tool.parameters.properties.prompt).toMatchObject({ type: 'string' })
    expect(makeFixture().tool.parameters.required).toContain('prompt')
  })

  it('does not expose the removed workspace_id input', () => {
    expect(makeFixture().tool.parameters).not.toHaveProperty('workspace_id')
  })

  it('requires model.provider in the nested schema', () => {
    const model = makeFixture().tool.parameters.properties.model
    expect(model.properties.provider).toMatchObject({ type: 'string' })
    expect(model.required).toContain('provider')
  })

  it('requires model.model in the nested schema', () => {
    const model = makeFixture().tool.parameters.properties.model
    expect(model.properties.model).toMatchObject({ type: 'string' })
    expect(model.required).toContain('model')
  })

  it('keeps reasoningEffort optional and string-valued', () => {
    expect(makeFixture().tool.parameters.properties.model.properties.reasoningEffort).toMatchObject({ type: 'string' })
    expect(makeFixture().tool.parameters.properties.model.properties.reasoningEffort.required).toBeUndefined()
  })

  it('keeps cwd optional and string-valued', () => {
    expect(makeFixture().tool.parameters.properties.cwd).toMatchObject({ type: 'string' })
    expect(makeFixture().tool.parameters.properties.cwd.required).toBeUndefined()
  })

  it('accepts an explicit provider and model', async () => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm' } })).resolves.toMatchObject({ accepted: true })
  })

  it('trims an explicit provider before resolving it', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: 'hello', model: { provider: '  p  ', model: 'm' } })
    expect(fixture.resolveCallConfig).toHaveBeenCalledWith({ provider: 'p', model: 'm' }, expect.any(AbortSignal))
  })

  it('trims an explicit model before resolving it', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: '  m  ' } })
    expect(fixture.resolveCallConfig).toHaveBeenCalledWith({ provider: 'p', model: 'm' }, expect.any(AbortSignal))
  })

  it.each(['low'])('accepts the %s effort identifier', async effort => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: effort } })).resolves.toMatchObject({ status: 'queued' })
  })

  it.each(['medium'])('accepts the %s effort identifier', async effort => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: effort } })).resolves.toMatchObject({ status: 'queued' })
  })

  it.each(['high'])('accepts the %s effort identifier', async effort => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: effort } })).resolves.toMatchObject({ status: 'queued' })
  })

  it.each(['xhigh'])('accepts the %s effort identifier', async effort => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: effort } })).resolves.toMatchObject({ status: 'queued' })
  })

  it.each(['max'])('accepts the %s effort identifier', async effort => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: effort } })).resolves.toMatchObject({ status: 'queued' })
  })

  it.each(['off'])('accepts the %s adapter effort identifier', async effort => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: effort } })).resolves.toMatchObject({ status: 'queued' })
  })

  it('trims reasoningEffort before passing it to the resolver', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: 'hello', model: { provider: 'p', model: 'm', reasoningEffort: '  high  ' } })
    expect(fixture.resolveCallConfig).toHaveBeenCalledWith({ provider: 'p', model: 'm', reasoningEffort: 'high' }, expect.any(AbortSignal))
  })

  it('uses the configured default model when model is omitted', async () => {
    const fixture = makeFixture({ defaultSelection: { provider: 'configured-provider', model: 'configured-model' } })
    await invoke(fixture.tool, { prompt: 'use default' })
    expect(fixture.agents.create).toHaveBeenCalledWith(expect.objectContaining({ agentOptions: { provider: 'configured-provider', model: 'configured-model' } }))
  })

  it('forwards prompt text without rewriting it', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: '  preserve this\nexactly  ', model: { provider: 'p', model: 'm' } })
    expect(fixture.handle.agent.followup).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: '  preserve this\nexactly  ' }] }))
  })

  it('forwards the execution signal to agent creation', async () => {
    const fixture = makeFixture()
    const controller = new AbortController()
    await invoke(fixture.tool, { prompt: 'signal', model: { provider: 'p', model: 'm' } }, { signal: controller.signal })
    expect(fixture.agents.create).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })

  it('returns accepted true for a queued session', async () => {
    const result = await invoke(makeFixture().tool, { prompt: 'queue me' })
    expect(result).toMatchObject({ accepted: true, status: 'queued' })
  })

  it('returns a string session id', async () => {
    const result = await invoke(makeFixture().tool, { prompt: 'id please' })
    expect(typeof result.session_id).toBe('string')
  })

  it('omits workspace_id when cwd has no registered workspace', async () => {
    const result = await invoke(makeFixture().tool, { prompt: 'no workspace', cwd })
    expect(result).not.toHaveProperty('workspace_id')
  })

  it('accepts an existing absolute cwd', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'directory', cwd })).resolves.toMatchObject({ cwd })
  })

  it('trims cwd before canonicalizing it', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'directory', cwd: `  ${cwd}  ` })).resolves.toMatchObject({ cwd })
  })

  it('returns a registered workspace id for cwd', async () => {
    const workspace = { id: 'workspace-1', path: cwd, attachSession: vi.fn(async () => {}) }
    const result = await invoke(makeFixture({ workspace }).tool, { prompt: 'workspace', cwd })
    expect(result.workspace_id).toBe('workspace-1')
  })

  it('attaches the new session to its resolved workspace', async () => {
    const workspace = { id: 'workspace-2', path: cwd, attachSession: vi.fn(async () => {}) }
    const result = await invoke(makeFixture({ workspace }).tool, { prompt: 'attach', cwd })
    expect(workspace.attachSession).toHaveBeenCalledWith(result.session_id)
  })

  it('persists cwd in the agent metadata', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: 'metadata', cwd })
    expect(fixture.agents.create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd } }))
  })

  it('passes the caller agent to the creation service', async () => {
    const createSession = vi.fn(async () => ({ session_id: 'child', accepted: true, status: 'queued' }))
    const tool = registerTool({ createSession })
    const parent = { id: 'parent-agent' }
    const signal = new AbortController().signal
    await invoke(tool, { prompt: 'child' }, { agent: parent, signal })
    expect(createSession).toHaveBeenCalledWith({ prompt: 'child' }, parent, signal)
  })

  it('calls the model resolver for an explicit route', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: 'resolve', model: { provider: 'provider', model: 'model' } })
    expect(fixture.resolveCallConfig).toHaveBeenCalledOnce()
  })
})

describe('session_create tool edge cases — MEDIUM (20)', () => {
  it('rejects a missing prompt', async () => {
    await expect(invoke(makeFixture().tool, {})).rejects.toThrow(/missing required property "prompt"/)
  })

  it('rejects a blank prompt', async () => {
    await expect(invoke(makeFixture().tool, { prompt: '   ' })).rejects.toThrow('prompt must be a non-empty string')
  })

  it('rejects a non-string prompt', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 42 })).rejects.toThrow(/"prompt" must be a string/)
  })

  it('rejects a model without provider', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'route', model: { model: 'm' } })).rejects.toThrow(/missing required property "model\.provider"/)
  })

  it('rejects a blank provider', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'route', model: { provider: '  ', model: 'm' } })).rejects.toThrow('model.provider must be a non-empty string')
  })

  it('rejects a non-string provider', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'route', model: { provider: 7, model: 'm' } })).rejects.toThrow(/"model\.provider" must be a string/)
  })

  it('rejects a model without model id', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'route', model: { provider: 'p' } })).rejects.toThrow(/missing required property "model\.model"/)
  })

  it('rejects a blank model id', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'route', model: { provider: 'p', model: '  ' } })).rejects.toThrow('model.model must be a non-empty string')
  })

  it('rejects a non-string model id', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'route', model: { provider: 'p', model: false } })).rejects.toThrow(/"model\.model" must be a string/)
  })

  it('rejects a blank reasoning effort', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'effort', model: { provider: 'p', model: 'm', reasoningEffort: ' ' } })).rejects.toThrow('model.reasoningEffort must be a non-empty string')
  })

  it('rejects a non-string reasoning effort', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'effort', model: { provider: 'p', model: 'm', reasoningEffort: 3 } })).rejects.toThrow(/"model\.reasoningEffort" must be a string/)
  })

  it('rejects a blank cwd', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'cwd', cwd: '  ' })).rejects.toThrow('cwd must be a non-empty string')
  })

  it('rejects a relative cwd', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'cwd', cwd: 'relative/path' })).rejects.toThrow('cwd must be an absolute path')
  })

  it('rejects a missing cwd directory', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'cwd', cwd: join(cwd, 'missing-session-create-directory') })).rejects.toThrow()
  })

  it('rejects a cwd that points to a file', async () => {
    await expect(invoke(makeFixture().tool, { prompt: 'cwd', cwd: join(cwd, 'package.json') })).rejects.toThrow(/is not a directory/)
  })

  it('does not create an agent when model resolution fails', async () => {
    const resolveCallConfig = vi.fn(async () => { throw new Error('bad route') })
    const fixture = makeFixture({ resolveCallConfig })
    await expect(invoke(fixture.tool, { prompt: 'route', model: { provider: 'p', model: 'm' } })).rejects.toThrow('bad route')
    expect(fixture.agents.create).not.toHaveBeenCalled()
  })

  it('rejects when no default model is configured', async () => {
    await expect(invoke(makeFixture({ hasDefault: false }).tool, { prompt: 'default' })).rejects.toThrow(/requires model\.provider and model\.model/)
  })

  it('rejects when the default selection is unavailable', async () => {
    await expect(invoke(makeFixture({ defaultSelection: null }).tool, { prompt: 'default' })).rejects.toThrow(/requires model\.provider and model\.model/)
  })

  it('propagates an explicit workspace lookup failure', async () => {
    const workspace = { id: 'workspace-error', path: cwd, attachSession: vi.fn(async () => {}) }
    const resolveWorkspace = vi.fn(async () => { throw new Error('workspace lookup failed') })
    await expect(invoke(makeFixture({ workspace, resolveWorkspace }).tool, { prompt: 'workspace', cwd })).rejects.toThrow('workspace lookup failed')
  })

  it('passes the execution signal to model resolution', async () => {
    const fixture = makeFixture()
    const signal = new AbortController().signal
    await invoke(fixture.tool, { prompt: 'signal', model: { provider: 'p', model: 'm' } }, { signal })
    expect(fixture.resolveCallConfig).toHaveBeenCalledWith({ provider: 'p', model: 'm' }, signal)
  })
})

describe('session_create tool edge cases — HARD (10)', () => {
  it('honors a signal already aborted before execution', async () => {
    const controller = new AbortController()
    controller.abort()
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'abort', model: { provider: 'p', model: 'm' } }, { signal: controller.signal })).rejects.toThrow()
    expect(fixture.agents.create).not.toHaveBeenCalled()
  })

  it('honors an abort received while resolving the model', async () => {
    const controller = new AbortController()
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const resolveCallConfig = vi.fn(async (config: unknown) => { await waiting; return config })
    const fixture = makeFixture({ resolveCallConfig })
    const pending = invoke(fixture.tool, { prompt: 'abort', model: { provider: 'p', model: 'm' } }, { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    release()
    await expect(pending).rejects.toThrow()
    expect(fixture.agents.create).not.toHaveBeenCalled()
  })

  it('propagates an agent creation failure', async () => {
    const create = vi.fn(async () => { throw new Error('agent create failed') })
    await expect(invoke(makeFixture({ create }).tool, { prompt: 'create', model: { provider: 'p', model: 'm' } })).rejects.toThrow('agent create failed')
  })

  it('disposes the handle when workspace attachment fails', async () => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const create = vi.fn(async () => handle)
    const workspace = { id: 'workspace-attach-fail', path: cwd, attachSession: vi.fn(async () => { throw new Error('attach failed') }) }
    const fixture = makeFixture({ create, workspace })
    await expect(invoke(fixture.tool, { prompt: 'attach', cwd })).rejects.toThrow('attach failed')
    expect(handle.dispose).toHaveBeenCalledOnce()
    expect(handle.agent.followup).not.toHaveBeenCalled()
  })

  it('disposes the handle when the initial followup fails', async () => {
    const handle = { agent: { followup: vi.fn(() => { throw new Error('followup failed') }) }, dispose: vi.fn(async () => {}) }
    const create = vi.fn(async () => handle)
    const fixture = makeFixture({ create })
    await expect(invoke(fixture.tool, { prompt: 'followup', model: { provider: 'p', model: 'm' } })).rejects.toThrow('followup failed')
    expect(handle.dispose).toHaveBeenCalledOnce()
  })

  it('inherits a parent provider and model when the child omits model', async () => {
    const fixture = makeFixture()
    const parent = { options: { provider: 'parent-provider', model: 'parent-model' }, session: { header: {}, requestHeader: () => undefined }, ctx: { get: () => undefined } }
    await invoke(fixture.tool, { prompt: 'inherit' }, { agent: parent })
    expect(fixture.agents.create).toHaveBeenCalledWith(expect.objectContaining({ agentOptions: { provider: 'parent-provider', model: 'parent-model' } }))
  })

  it('inherits a parent reasoning effort from its request header', async () => {
    const fixture = makeFixture()
    const parent = {
      options: { provider: 'parent-provider', model: 'parent-model' },
      session: { header: {}, requestHeader: () => ({ config: { provider: 'header-provider', model: 'header-model', reasoningEffort: 'header-effort' } }) },
      ctx: { get: () => undefined },
    }
    await invoke(fixture.tool, { prompt: 'inherit effort' }, { agent: parent })
    const setup = fixture.agents.create.mock.calls[0]?.[0]?.setup
    expect(setup).toEqual(expect.any(Function))
  })

  it('inherits a parent cwd when cwd is omitted', async () => {
    const fixture = makeFixture()
    const parent = { options: { provider: 'p', model: 'm' }, session: { header: { cwd }, requestHeader: () => undefined }, ctx: { get: () => undefined } }
    await expect(invoke(fixture.tool, { prompt: 'inherit cwd' }, { agent: parent })).resolves.toMatchObject({ cwd })
    expect(fixture.agents.create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd } }))
  })

  it('rejects an explicit preset when the preset service is absent', async () => {
    const fixture = makeFixture()
    await expect(invoke(fixture.tool, { prompt: 'preset', preset: 'missing-preset' })).rejects.toThrow(/agent presets to be configured/)
    expect(fixture.agents.create).not.toHaveBeenCalled()
  })

  it('installs an explicit effort through the created agent setup', async () => {
    const fixture = makeFixture()
    await invoke(fixture.tool, { prompt: 'install effort', model: { provider: 'p', model: 'm', reasoningEffort: 'high' } })
    const setup = fixture.agents.create.mock.calls[0]?.[0]?.setup as ((ctx: unknown) => Promise<void>) | undefined
    expect(setup).toEqual(expect.any(Function))
    const listeners: Array<(...args: any[]) => any> = []
    await setup!({ on: vi.fn((_event: string, listener: (...args: any[]) => any) => { listeners.push(listener); return () => {} }) })
    await listeners[0]!({}, {}, async () => ({ variables: {} }))
    await expect(listeners[1]!(undefined, async () => ({ provider: 'p', model: 'm', reasoningEffort: 'low' }))).resolves.toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
  })
})
