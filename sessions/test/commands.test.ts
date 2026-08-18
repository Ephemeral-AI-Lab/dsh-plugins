import { describe, expect, it, vi } from 'vitest'
import { parseCreateSessionArgs, parseSessionsCommand, registerSessionsCommand } from '../src/commands.js'

describe('sessions slash command', () => {
  it('parses status and read subcommands', () => {
    expect(parseSessionsCommand('status')).toEqual({ kind: 'status', args: {} })
    expect(parseSessionsCommand('status --recent 20')).toEqual({ kind: 'status', args: { recent_n: 20 } })
    expect(parseSessionsCommand('status session-1')).toEqual({ kind: 'status', args: { session_id: 'session-1' } })
    expect(parseSessionsCommand('status session-1 --recent=20')).toEqual({
      kind: 'status',
      args: { session_id: 'session-1', recent_n: 20 },
    })
    expect(parseSessionsCommand('read session-1')).toEqual({ kind: 'read', args: { session_id: 'session-1' } })
    expect(parseSessionsCommand('read session-1 --offset 3 --limit 20')).toEqual({
      kind: 'read',
      args: { session_id: 'session-1', offset: 3, limit: 20 },
    })
    expect(parseSessionsCommand('read session-1 --limit=20 --offset=3')).toEqual({
      kind: 'read',
      args: { session_id: 'session-1', offset: 3, limit: 20 },
    })
    expect(parseSessionsCommand('create "check the build" --preset coding --model openai/gpt-5 --effort high --cwd "C:\\workspace"')).toEqual({
      kind: 'create',
      args: {
        prompt: 'check the build',
        preset: 'coding',
        model: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' },
        cwd: 'C:\\workspace',
      },
    })
    expect(parseSessionsCommand('create --prompt "check the build" --provider openai --model gpt-5 --reasoning-effort high')).toEqual({
      kind: 'create',
      args: {
        prompt: 'check the build',
        model: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' },
      },
    })
    expect(parseCreateSessionArgs('{"prompt":"check the build","model":{"provider":"openai","model":"gpt-5","reasoningEffort":"high"}}'))
      .toEqual({ prompt: 'check the build', model: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' } })
  })

  it('rejects invalid input', () => {
    expect(parseSessionsCommand('')).toBeUndefined()
    expect(parseSessionsCommand('list')).toBeUndefined()
    expect(parseSessionsCommand('status --recent 0')).toBeUndefined()
    expect(parseSessionsCommand('status --recent 1 --recent 2')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --offset 0')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --limit 201')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --offset 1 --offset 2')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --unknown 1')).toBeUndefined()
    expect(parseSessionsCommand('create')).toBeUndefined()
    expect(parseSessionsCommand('create check --provider openai')).toBeUndefined()
    expect(parseSessionsCommand('create check --effort high')).toBeUndefined()
    expect(parseSessionsCommand('create check --effort high --reasoning-effort low --model openai/gpt-5')).toBeUndefined()
    expect(parseSessionsCommand('create check --workspace-id workspace-1')).toBeUndefined()
    expect(parseSessionsCommand('create {"prompt":"check","workspace_id":"workspace-1"}')).toBeUndefined()
  })

  it('renders the service result with title and id fallback', async () => {
    const service = {
      listStatus: vi.fn(async () => ({
        sessions: [
          { session_id: 'named-id', title: 'Named', status: 'idle', updated_at: '2026-01-01T00:00:00.000Z' },
          { session_id: 'fallback-id', status: 'cold', updated_at: '2026-01-02T00:00:00.000Z' },
        ],
      })),
    }
    let definition: { handler: (invocation: { rawInput: string; signal: AbortSignal }) => Promise<unknown> } | undefined
    const ctx = {
      commands: {
        register(value: typeof definition extends infer T ? T : never) {
          definition = value as typeof definition
          return vi.fn()
        },
      },
    }

    registerSessionsCommand(ctx as never, service as never)
    const result = await definition!.handler({ rawInput: 'status --recent 2', signal: new AbortController().signal }) as { kind: string; text: string }
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Named')
    expect(result.text).toContain('fallback-id')
    expect(service.listStatus).toHaveBeenCalledWith({ recent_n: 2 }, expect.any(AbortSignal))
  })

  it('creates a session through the shared creation service', async () => {
    const creationService = {
      createSession: vi.fn(async (args: unknown) => ({
        session_id: 'session-created',
        accepted: true as const,
        status: 'queued' as const,
        args,
      })),
    }
    let definition: { handler: (invocation: { agent: unknown; rawInput: string; signal: AbortSignal }) => Promise<unknown> } | undefined
    const ctx = {
      commands: {
        register(value: typeof definition extends infer T ? T : never) {
          definition = value as typeof definition
          return vi.fn()
        },
      },
    }

    registerSessionsCommand(ctx as never, {} as never, creationService as never)
    const result = await definition!.handler({
      agent: {},
      rawInput: 'create "start the child" --model provider/model --effort high',
      signal: new AbortController().signal,
    }) as { kind: string; text: string }

    expect(result).toEqual({
      kind: 'success',
      text: JSON.stringify({
        session_id: 'session-created',
        accepted: true,
        status: 'queued',
        args: {
          prompt: 'start the child',
          model: { provider: 'provider', model: 'model', reasoningEffort: 'high' },
        },
      }),
    })
    expect(creationService.createSession).toHaveBeenCalledWith(
      { prompt: 'start the child', model: { provider: 'provider', model: 'model', reasoningEffort: 'high' } },
      {},
      expect.any(AbortSignal),
    )
  })
})
