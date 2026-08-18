import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

interface RegisteredCreateTool {
  name: string
  parameters?: unknown
  execute(args: unknown, exec: { agent?: unknown; signal: AbortSignal }): Promise<unknown>
}

describe('create_session plugin boundary', () => {
  it('registers and executes create_session through the public tool entrypoint', async () => {
    const registered: RegisteredCreateTool[] = []
    const cleanups: Array<() => void | Promise<void>> = []
    const followup = vi.fn()
    const handle = {
      agent: { followup },
      dispose: vi.fn(async () => {}),
    }
    const agents = { create: vi.fn(async () => handle) }
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    const ctx = {
      tools: {
        register(definition: RegisteredCreateTool) {
          registered.push(definition)
          return () => {
            const index = registered.indexOf(definition)
            if (index >= 0) registered.splice(index, 1)
          }
        },
      },
      commands: {
        register() { return () => {} },
      },
      agents,
      sessionPersistence: { list: vi.fn(async () => []) },
      sessionQuery: { readTitleSnapshots: vi.fn(async () => []) },
      workspaceRegistry: {
        resolveByPath: vi.fn(),
      },
      get(name: string) {
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
        }
        if (name === 'llm') return { resolveCallConfig }
        if (name === 'workspaceRegistry') return ctx.workspaceRegistry
        return undefined
      },
      effect(body: () => () => void | Promise<void>) {
        cleanups.push(body())
        return () => {}
      },
    }

    apply(ctx as never)
    const tool = registered.find(candidate => candidate.name === 'create_session')
    expect(tool).toBeDefined()
    expect(tool!.parameters).toMatchObject({
      properties: expect.not.objectContaining({ workspace_id: expect.anything() }),
    })
    expect(tool!.parameters).toMatchObject({
      properties: {
        model: {
          properties: {
            reasoningEffort: { type: 'string' },
          },
        },
      },
    })

    const result = await tool!.execute(
      {
        prompt: 'run this in the selected directory',
        model: {
          provider: 'test-provider',
          model: 'test-model',
          reasoningEffort: 'high',
        },
      },
      { signal: new AbortController().signal },
    )

    expect(result).toMatchObject({
      accepted: true,
      status: 'queued',
    })
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'test-provider', model: 'test-model' },
      setup: expect.any(Function),
    }))
    expect(resolveCallConfig).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'test-model',
      reasoningEffort: 'high',
    }, expect.any(AbortSignal))
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: [{ type: 'text', text: 'run this in the selected directory' }],
    }))

    for (const cleanup of cleanups.reverse()) await cleanup()
  })
})
