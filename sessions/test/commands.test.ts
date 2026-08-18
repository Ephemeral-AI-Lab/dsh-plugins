import { describe, expect, it, vi } from 'vitest'
import { parseSessionsCommand, registerSessionsCommand } from '../src/commands.js'

describe('sessions slash command', () => {
  it('parses list, status, and read subcommands', () => {
    expect(parseSessionsCommand('list')).toEqual({ kind: 'list', args: {} })
    expect(parseSessionsCommand('list --limit 20')).toEqual({ kind: 'list', args: { limit: 20 } })
    expect(parseSessionsCommand('status session-1')).toEqual({ kind: 'status', session_id: 'session-1' })
    expect(parseSessionsCommand('read session-1')).toEqual({ kind: 'read', args: { session_id: 'session-1' } })
    expect(parseSessionsCommand('read session-1 --offset 3 --limit 20')).toEqual({
      kind: 'read',
      args: { session_id: 'session-1', offset: 3, limit: 20 },
    })
    expect(parseSessionsCommand('read session-1 --limit=20 --offset=3')).toEqual({
      kind: 'read',
      args: { session_id: 'session-1', offset: 3, limit: 20 },
    })
  })

  it('rejects invalid input', () => {
    expect(parseSessionsCommand('')).toBeUndefined()
    expect(parseSessionsCommand('list 20')).toBeUndefined()
    expect(parseSessionsCommand('list --limit 0')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --offset 0')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --limit 201')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --offset 1 --offset 2')).toBeUndefined()
    expect(parseSessionsCommand('read session-1 --unknown 1')).toBeUndefined()
  })

  it('renders the service result with title and id fallback', async () => {
    const service = {
      listSessions: vi.fn(async () => ({
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
    const result = await definition!.handler({ rawInput: 'list --limit 2', signal: new AbortController().signal }) as { kind: string; text: string }
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Named')
    expect(result.text).toContain('fallback-id')
    expect(service.listSessions).toHaveBeenCalledWith({ limit: 2 }, expect.any(AbortSignal))
  })
})
