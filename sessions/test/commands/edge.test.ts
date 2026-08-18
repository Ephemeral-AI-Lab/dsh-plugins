import { describe, expect, it, vi } from 'vitest'
import { parseCreateSessionArgs, parseSendSessionArgs, parseSessionsCommand, registerSessionsCommand } from '../../src/commands.js'

type CommandDefinition = {
  handler: (input: { agent: unknown; rawInput: string; signal: AbortSignal }) => Promise<unknown>
}

function captureCommand() {
  let definition: CommandDefinition | undefined
  const ctx = {
    commands: {
      register(value: CommandDefinition) {
        definition = value
        return vi.fn()
      },
    },
  }
  return {
    ctx,
    definition: () => {
      if (definition === undefined) throw new Error('command was not registered')
      return definition
    },
  }
}

function invocation(rawInput: string) {
  return { agent: { id: 'parent' }, rawInput, signal: new AbortController().signal }
}

describe('CLI parsers: easy cases (30)', () => {
  it('trims a status command', () => {
    expect(parseSessionsCommand('  status  ')).toEqual({ kind: 'status', args: {} })
  })

  it('parses an empty status option set', () => {
    expect(parseSessionsCommand('status')).toEqual({ kind: 'status', args: {} })
  })

  it('parses a status session id', () => {
    expect(parseSessionsCommand('status session-a')).toEqual({ kind: 'status', args: { session_id: 'session-a' } })
  })

  it('parses inline recent', () => {
    expect(parseSessionsCommand('status --recent=7')).toEqual({ kind: 'status', args: { recent_n: 7 } })
  })

  it('parses the recent-n alias', () => {
    expect(parseSessionsCommand('status --recent-n 8')).toEqual({ kind: 'status', args: { recent_n: 8 } })
  })

  it('parses status id and recent together', () => {
    expect(parseSessionsCommand('status session-a --recent 9')).toEqual({
      kind: 'status',
      args: { session_id: 'session-a', recent_n: 9 },
    })
  })

  it('parses read with defaults', () => {
    expect(parseSessionsCommand('read session-a')).toEqual({ kind: 'read', args: { session_id: 'session-a' } })
  })

  it('parses read offset', () => {
    expect(parseSessionsCommand('read session-a --offset 2')).toEqual({
      kind: 'read',
      args: { session_id: 'session-a', offset: 2 },
    })
  })

  it('parses read limit', () => {
    expect(parseSessionsCommand('read session-a --limit 12')).toEqual({
      kind: 'read',
      args: { session_id: 'session-a', limit: 12 },
    })
  })

  it('parses read options in either order', () => {
    expect(parseSessionsCommand('read session-a --limit=12 --offset=2')).toEqual({
      kind: 'read',
      args: { session_id: 'session-a', offset: 2, limit: 12 },
    })
  })

  it('parses send with the default mode', () => {
    expect(parseSendSessionArgs('session-a inspect build')).toEqual({
      session_id: 'session-a',
      message: 'inspect build',
    })
  })

  it('joins a quoted send message', () => {
    expect(parseSendSessionArgs('session-a "inspect the build"')).toEqual({
      session_id: 'session-a',
      message: 'inspect the build',
    })
  })

  it('parses explicit steer mode', () => {
    expect(parseSendSessionArgs('session-a inspect --mode steer')).toEqual({
      session_id: 'session-a', message: 'inspect', mode: 'steer',
    })
  })

  it('parses explicit followup mode', () => {
    expect(parseSendSessionArgs('session-a continue --mode followup')).toEqual({
      session_id: 'session-a', message: 'continue', mode: 'followup',
    })
  })

  it('parses inline send mode', () => {
    expect(parseSendSessionArgs('session-a continue --mode=followup')).toEqual({
      session_id: 'session-a', message: 'continue', mode: 'followup',
    })
  })

  it('parses a positional create prompt', () => {
    expect(parseCreateSessionArgs('review the build')).toEqual({ prompt: 'review the build' })
  })

  it('preserves a quoted create prompt as one value', () => {
    expect(parseCreateSessionArgs('"review the build"')).toEqual({ prompt: 'review the build' })
  })

  it('parses a prompt option', () => {
    expect(parseCreateSessionArgs('--prompt "review the build"')).toEqual({ prompt: 'review the build' })
  })

  it('parses a preset option', () => {
    expect(parseCreateSessionArgs('review --preset coding')).toEqual({ prompt: 'review', preset: 'coding' })
  })

  it('parses a cwd option', () => {
    expect(parseCreateSessionArgs('review --cwd "C:\\repo"')).toEqual({ prompt: 'review', cwd: 'C:\\repo' })
  })

  it('parses separate provider and model options', () => {
    expect(parseCreateSessionArgs('review --provider local --model thinker')).toEqual({
      prompt: 'review', model: { provider: 'local', model: 'thinker' },
    })
  })

  it('maps effort to reasoning effort', () => {
    expect(parseCreateSessionArgs('review --provider local --model thinker --effort low')).toEqual({
      prompt: 'review', model: { provider: 'local', model: 'thinker', reasoningEffort: 'low' },
    })
  })

  it('accepts the long reasoning-effort spelling', () => {
    expect(parseCreateSessionArgs('review --provider local --model thinker --reasoning-effort high')).toEqual({
      prompt: 'review', model: { provider: 'local', model: 'thinker', reasoningEffort: 'high' },
    })
  })

  it('stops create option parsing after --', () => {
    expect(parseCreateSessionArgs('review -- --provider local')).toEqual({ prompt: 'review --provider local' })
  })

  it('parses a minimal JSON create form', () => {
    expect(parseCreateSessionArgs('{"prompt":"review"}')).toEqual({ prompt: 'review' })
  })

  it('parses a JSON model selection', () => {
    expect(parseCreateSessionArgs('{"prompt":"review","model":{"provider":"local","model":"thinker"}}'))
      .toEqual({ prompt: 'review', model: { provider: 'local', model: 'thinker' } })
  })

  it('parses JSON preset and cwd', () => {
    expect(parseCreateSessionArgs('{"prompt":"review","preset":"coding","cwd":"C:\\\\repo"}')).toEqual({
      prompt: 'review', preset: 'coding', cwd: 'C:\\repo',
    })
  })

  it('ignores surrounding whitespace around JSON', () => {
    expect(parseCreateSessionArgs('  {"prompt":"review"}  ')).toEqual({ prompt: 'review' })
  })

  it('trims whitespace around a read command', () => {
    expect(parseSessionsCommand('\n read session-a \t')).toEqual({ kind: 'read', args: { session_id: 'session-a' } })
  })

  it('allows flag-like send text after --', () => {
    expect(parseSendSessionArgs('session-a -- --unknown --mode followup')).toEqual({
      session_id: 'session-a', message: '--unknown --mode followup',
    })
  })
})

describe('CLI parsers: medium cases (20)', () => {
  it('rejects a status recent flag without a value', () => {
    expect(parseSessionsCommand('status --recent')).toBeUndefined()
  })

  it('rejects nonnumeric recent', () => {
    expect(parseSessionsCommand('status --recent many')).toBeUndefined()
  })

  it('rejects zero recent', () => {
    expect(parseSessionsCommand('status --recent 0')).toBeUndefined()
  })

  it('rejects negative recent', () => {
    expect(parseSessionsCommand('status --recent -1')).toBeUndefined()
  })

  it('rejects fractional recent', () => {
    expect(parseSessionsCommand('status --recent 1.5')).toBeUndefined()
  })

  it('rejects duplicate recent flags', () => {
    expect(parseSessionsCommand('status --recent 2 --recent=3')).toBeUndefined()
  })

  it('rejects unknown status options', () => {
    expect(parseSessionsCommand('status --all')).toBeUndefined()
  })

  it('rejects extra status positionals', () => {
    expect(parseSessionsCommand('status first second')).toBeUndefined()
  })

  it('rejects read without a session id', () => {
    expect(parseSessionsCommand('read')).toBeUndefined()
  })

  it('rejects zero read offset', () => {
    expect(parseSessionsCommand('read session-a --offset 0')).toBeUndefined()
  })

  it('rejects a read limit over the service cap', () => {
    expect(parseSessionsCommand('read session-a --limit 201')).toBeUndefined()
  })

  it('rejects unknown read options', () => {
    expect(parseSessionsCommand('read session-a --recent 2')).toBeUndefined()
  })

  it('rejects duplicate read options', () => {
    expect(parseSessionsCommand('read session-a --limit 2 --limit=3')).toBeUndefined()
  })

  it('rejects a read option without a value', () => {
    expect(parseSessionsCommand('read session-a --limit')).toBeUndefined()
  })

  it('rejects send without a message', () => {
    expect(parseSendSessionArgs('session-a')).toBeUndefined()
  })

  it('rejects an unknown send option', () => {
    expect(parseSendSessionArgs('session-a hello --urgent')).toBeUndefined()
  })

  it('rejects an invalid send mode', () => {
    expect(parseSendSessionArgs('session-a hello --mode queue')).toBeUndefined()
  })

  it('rejects duplicate send modes', () => {
    expect(parseSendSessionArgs('session-a hello --mode steer --mode followup')).toBeUndefined()
  })

  it('rejects a send mode without a value', () => {
    expect(parseSendSessionArgs('session-a hello --mode')).toBeUndefined()
  })

  it('rejects an unterminated send quote', () => {
    expect(parseSendSessionArgs('session-a "unfinished')).toBeUndefined()
  })
})

describe('CLI parsers and subcommands: hard cases (10)', () => {
  it('rejects create when provider has no model', () => {
    expect(parseCreateSessionArgs('review --provider local')).toBeUndefined()
  })

  it('rejects create when model has no provider', () => {
    expect(parseCreateSessionArgs('review --model thinker')).toBeUndefined()
  })

  it('rejects effort without a complete model selection', () => {
    expect(parseCreateSessionArgs('review --effort high')).toBeUndefined()
  })

  it('rejects both effort aliases together', () => {
    expect(parseCreateSessionArgs('review --provider local --model thinker --effort high --reasoning-effort low')).toBeUndefined()
  })

  it('rejects a positional prompt combined with --prompt', () => {
    expect(parseCreateSessionArgs('review --prompt inspect')).toBeUndefined()
  })

  it('rejects malformed JSON create input', () => {
    expect(parseCreateSessionArgs('{"prompt":}')).toBeUndefined()
  })

  it('rejects unknown JSON create fields', () => {
    expect(parseCreateSessionArgs('{"prompt":"review","workspace_id":"workspace-a"}')).toBeUndefined()
  })

  it('returns usage for an unknown slash subcommand', async () => {
    const service = { listStatus: vi.fn(async () => ({ sessions: [] })) }
    const { ctx, definition } = captureCommand()
    registerSessionsCommand(ctx as never, service as never)
    const result = await definition().handler(invocation('list')) as { kind: string; text: string }
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Usage: /sessions')
  })

  it('maps a status service failure to a command error', async () => {
    const service = { listStatus: vi.fn(async () => { throw new Error('status unavailable') }) }
    const { ctx, definition } = captureCommand()
    registerSessionsCommand(ctx as never, service as never)
    const result = await definition().handler(invocation('status')) as { kind: string; text: string }
    expect(result).toEqual({ kind: 'error', text: 'status unavailable' })
  })

  it('returns the unavailable response when sending is not wired', async () => {
    const { ctx, definition } = captureCommand()
    registerSessionsCommand(ctx as never, {} as never)
    const result = await definition().handler(invocation('send session-a hello')) as { kind: string; text: string }
    expect(result).toEqual({ kind: 'error', text: 'Session sending is unavailable.' })
  })
})
