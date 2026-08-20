import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionCreationService } from '../src/creation-service.js'

describe('SessionCreationService', () => {
  it('validates an explicit model and queues the initial prompt', async () => {
    const handle = {
      agent: { followup: vi.fn() },
      dispose: vi.fn(async () => {}),
    }
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    const agents = { create: vi.fn(async () => handle) }
    const ctx = {
      agents,
      get(name: string) {
        return name === 'llm' ? { resolveCallConfig } : undefined
      },
    }

    const service = new SessionCreationService(ctx as never)
    await expect(service.createSession({
      prompt: 'hello child',
      model: { provider: 'mock-provider', model: 'mock-model' },
    })).resolves.toMatchObject({ accepted: true, status: 'queued' })

    expect(resolveCallConfig).toHaveBeenCalledWith(
      { provider: 'mock-provider', model: 'mock-model' },
      undefined,
    )
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'mock-provider', model: 'mock-model' },
    }))
    expect(handle.agent.followup).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: [{ type: 'text', text: 'hello child' }],
      source: { kind: 'user' },
    }))
  })

  it('validates an explicit reasoning effort and installs it for the new agent', async () => {
    const handle = {
      agent: { followup: vi.fn() },
      dispose: vi.fn(async () => {}),
    }
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    const agents = { create: vi.fn(async () => handle) }
    const ctx = {
      agents,
      get(name: string) {
        return name === 'llm' ? { resolveCallConfig } : undefined
      },
    }

    const service = new SessionCreationService(ctx as never)
    await service.createSession({
      prompt: 'use high effort',
      model: { provider: 'mock-provider', model: 'mock-model', reasoningEffort: 'high' },
    })

    expect(resolveCallConfig).toHaveBeenCalledWith(
      { provider: 'mock-provider', model: 'mock-model', reasoningEffort: 'high' },
      undefined,
    )
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'mock-provider', model: 'mock-model' },
      setup: expect.any(Function),
    }))

    const options = agents.create.mock.calls[0]?.[0] as {
      setup: (agentCtx: { on: (event: string, listener: (...args: any[]) => Promise<unknown>) => () => void }) => Promise<void>
    }
    const listeners: Array<(...args: any[]) => Promise<unknown>> = []
    await options.setup({
      on: vi.fn((_event: string, listener: (...args: any[]) => Promise<unknown>) => {
        listeners.push(listener)
        return () => {}
      }),
    })
    await listeners[0]({}, {}, async () => ({ variables: {} }))
    const requestListener = listeners[1]!
    await expect(requestListener(undefined, async () => ({
      provider: 'mock-provider',
      model: 'mock-model',
      reasoningEffort: 'low',
    }))).resolves.toEqual({
      provider: 'mock-provider',
      model: 'mock-model',
      reasoningEffort: 'high',
    })
  })

  it('uses the deployment default when no model is supplied', async () => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const agents = { create: vi.fn(async () => handle) }
    const ctx = {
      agents,
      get(name: string) {
        return name === 'agentDefaultModel'
          ? { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) }
          : undefined
      },
    }

    const service = new SessionCreationService(ctx as never)
    await service.createSession({ prompt: 'use default' })

    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'default-provider', model: 'default-model' },
    }))
  })

  it('uses the deployment default preset for a root create when preset is omitted', async () => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const agents = { create: vi.fn(async () => handle) }
    const mount = vi.fn(async () => {})
    const resolve = vi.fn(async () => ({ id: 'default-preset' }))
    const ctx = {
      agents,
      get(name: string) {
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) }
        }
        return name === 'agentPresets' ? { resolve, mount } : undefined
      },
    }

    const service = new SessionCreationService(ctx as never)
    await service.createSession({ prompt: 'use both defaults' })

    const options = agents.create.mock.calls[0]?.[0] as {
      meta: unknown
      setup?: (agentCtx: object) => Promise<void>
    }
    expect(options.meta).toEqual({ agentPreset: 'default-preset' })
    expect(resolve).toHaveBeenCalledWith()
    const agentCtx = mockAgentContext()
    await options.setup!(agentCtx)
    expect(mount).toHaveBeenCalledWith(agentCtx, 'default-preset')
  })

  it('inherits the caller route and preset for a child session', async () => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const agents = { create: vi.fn(async () => handle) }
    const composeFrom = vi.fn()
    const parentPresets = {
      composedPreset: vi.fn(() => 'coding'),
      composeFrom,
    }
    const parent = {
      options: { provider: 'parent-provider', model: 'parent-model' },
      session: {
        header: { cwd: 'C:\\workspace' },
        requestHeader: vi.fn(() => undefined),
      },
      ctx: { get: vi.fn(() => parentPresets) },
    }
    const ctx = { agents, get: vi.fn(() => undefined) }

    const service = new SessionCreationService(ctx as never)
    await service.createSession({ prompt: 'inherit me' }, parent as never)

    const options = agents.create.mock.calls[0]?.[0] as {
      agentOptions: unknown
      meta: unknown
      setup?: (agentCtx: object) => Promise<void>
    }
    expect(options.agentOptions).toEqual(parent.options)
    expect(options.meta).toEqual({ cwd: 'C:\\workspace', agentPreset: 'coding' })
    expect(options.setup).toEqual(expect.any(Function))

    const agentCtx = mockAgentContext()
    await options.setup!(agentCtx)
    expect(composeFrom).toHaveBeenCalledWith(agentCtx, parent.ctx)
  })

  it('joins the caller composition when the same preset is explicitly requested', async () => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const agents = { create: vi.fn(async () => handle) }
    const composeFrom = vi.fn()
    const parentPresets = {
      composedPreset: vi.fn(() => 'cordis'),
      composeFrom,
    }
    const presets = {
      resolve: vi.fn(async () => ({ id: 'cordis' })),
      mount: vi.fn(async () => {}),
    }
    const parent = {
      options: { provider: 'parent-provider', model: 'parent-model' },
      session: { header: {}, requestHeader: vi.fn(() => undefined) },
      ctx: { get: vi.fn(() => parentPresets) },
    }
    const ctx = {
      agents,
      get(name: string) {
        if (name === 'agentPresets') return presets
        return undefined
      },
    }

    const service = new SessionCreationService(ctx as never)
    await service.createSession({ prompt: 'reuse parent composition', preset: 'cordis' }, parent as never)

    const options = agents.create.mock.calls[0]?.[0] as { setup?: (agentCtx: object) => Promise<void> }
    const agentCtx = mockAgentContext()
    await options.setup!(agentCtx)
    expect(composeFrom).toHaveBeenCalledWith(agentCtx, parent.ctx)
    expect(presets.mount).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'model only',
      args: { prompt: 'explicit model', model: { provider: 'explicit-provider', model: 'explicit-model' } },
      expectedModel: { provider: 'explicit-provider', model: 'explicit-model' },
      expectedPreset: 'parent-preset',
    },
    {
      name: 'preset only',
      args: { prompt: 'explicit preset', preset: 'explicit-preset' },
      expectedModel: { provider: 'parent-provider', model: 'parent-model' },
      expectedPreset: 'explicit-preset',
    },
    {
      name: 'model and preset',
      args: {
        prompt: 'explicit model and preset',
        model: { provider: 'explicit-provider', model: 'explicit-model' },
        preset: 'explicit-preset',
      },
      expectedModel: { provider: 'explicit-provider', model: 'explicit-model' },
      expectedPreset: 'explicit-preset',
    },
  ])('resolves the $name combination independently', async ({ args, expectedModel, expectedPreset }) => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const agents = { create: vi.fn(async () => handle) }
    const presets = {
      composedPreset: vi.fn(() => 'parent-preset'),
      composeFrom: vi.fn(),
      resolve: vi.fn(async (id?: string) => ({ id: id ?? 'default-preset' })),
      mount: vi.fn(async () => {}),
    }
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    const parent = {
      options: { provider: 'parent-provider', model: 'parent-model' },
      session: {
        header: { cwd: 'C:\\workspace' },
        requestHeader: vi.fn(() => undefined),
      },
      ctx: { get: vi.fn(() => presets) },
    }
    const ctx = {
      agents,
      get(name: string) {
        if (name === 'agentPresets') return presets
        return name === 'llm' ? { resolveCallConfig } : undefined
      },
    }

    const service = new SessionCreationService(ctx as never)
    await service.createSession(args, parent as never)

    const options = agents.create.mock.calls[0]?.[0] as {
      agentOptions: unknown
      meta: unknown
      setup?: (agentCtx: object) => Promise<void>
    }
    expect(options.agentOptions).toEqual(expectedModel)
    expect(options.meta).toEqual({ cwd: 'C:\\workspace', agentPreset: expectedPreset })
    const agentCtx = mockAgentContext()
    await options.setup!(agentCtx)

    if (args.preset === undefined) {
      expect(presets.composeFrom).toHaveBeenCalledWith(agentCtx, parent.ctx)
    } else {
      expect(presets.resolve).toHaveBeenCalledWith(args.preset)
      expect(presets.mount).toHaveBeenCalledWith(agentCtx, args.preset)
    }
  })

  it('falls back to the deployment default preset when a child has no composed preset', async () => {
    const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
    const agents = { create: vi.fn(async () => handle) }
    const mount = vi.fn(async () => {})
    const presets = {
      composedPreset: vi.fn(() => undefined),
      resolve: vi.fn(async () => ({ id: 'default-preset' })),
      mount,
    }
    const parent = {
      options: { provider: 'parent-provider', model: 'parent-model' },
      session: { header: {}, requestHeader: vi.fn(() => undefined) },
      ctx: { get: vi.fn(() => presets) },
    }
    const ctx = { agents, get: vi.fn(() => undefined) }

    const service = new SessionCreationService(ctx as never)
    await service.createSession({ prompt: 'fallback preset' }, parent as never)

    const options = agents.create.mock.calls[0]?.[0] as {
      meta: unknown
      setup?: (agentCtx: object) => Promise<void>
    }
    expect(options.meta).toEqual({ agentPreset: 'default-preset' })
    const agentCtx = mockAgentContext()
    await options.setup!(agentCtx)
    expect(mount).toHaveBeenCalledWith(agentCtx, 'default-preset')
  })

  it('rejects a missing default route', async () => {
    const ctx = { agents: { create: vi.fn() }, get: vi.fn(() => undefined) }
    const service = new SessionCreationService(ctx as never)

    await expect(service.createSession({ prompt: 'no route' })).rejects.toThrow(
      /requires model\.provider and model\.model/,
    )
    expect(ctx.agents.create).not.toHaveBeenCalled()
  })

  it('canonicalizes cwd and reports its registered workspace when one owns it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-sessions-'))
    try {
      const canonical = await realpath(directory)
      const handle = { agent: { followup: vi.fn() }, dispose: vi.fn(async () => {}) }
      const agents = { create: vi.fn(async () => handle) }
      const workspace = { id: 'workspace-2', path: canonical, attachSession: vi.fn(async () => {}) }
      const registry = {
        resolveByPath: vi.fn(async () => workspace),
      }
      const ctx = {
        agents,
        get(name: string) {
          if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
          if (name === 'workspaceRegistry') return registry
          return undefined
        },
      }

      const service = new SessionCreationService(ctx as never)
      await expect(service.createSession({ prompt: 'cwd task', cwd: directory }))
        .resolves.toMatchObject({ workspace_id: 'workspace-2', cwd: canonical })
      expect(registry.resolveByPath).toHaveBeenCalledWith(canonical)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function mockAgentContext(): { on: ReturnType<typeof vi.fn> } {
  return { on: vi.fn(() => () => {}) }
}
