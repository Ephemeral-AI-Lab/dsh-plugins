import { describe, expect, it } from 'vitest'
import { formatReadSessionOutput } from '../../src/read-format.js'
import { parseReadSessionArgs, validateRecentN } from '../../src/service.js'
import type { ReadSessionMessage } from '../../src/types.js'

function message(overrides: Record<string, unknown> = {}): ReadSessionMessage {
  return {
    id: 'message-1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
    ...overrides,
  } as ReadSessionMessage
}

function readOutput(
  messages: ReadSessionMessage[],
  options: { session_id?: string; offset?: number; total_messages?: number } = {},
): string {
  return formatReadSessionOutput({
    session_id: options.session_id ?? 'session-basic',
    offset: options.offset ?? 1,
    messages,
    total_messages: options.total_messages ?? messages.length,
  })
}

describe('basic and shared methods: EASY cases', () => {
  it.each([
    ['uses read offset 1 by default', { session_id: 's' }, { session_id: 's', offset: 1, limit: 200 }],
    ['uses read limit 200 by default', { session_id: 's' }, { session_id: 's', offset: 1, limit: 200 }],
    ['keeps a simple session id', { session_id: 'alpha' }, { session_id: 'alpha', offset: 1, limit: 200 }],
    ['keeps offset 1', { session_id: 's', offset: 1 }, { session_id: 's', offset: 1, limit: 200 }],
    ['keeps limit 1', { session_id: 's', limit: 1 }, { session_id: 's', offset: 1, limit: 1 }],
    ['keeps offset 2', { session_id: 's', offset: 2 }, { session_id: 's', offset: 2, limit: 200 }],
    ['keeps limit 2', { session_id: 's', limit: 2 }, { session_id: 's', offset: 1, limit: 2 }],
    ['accepts the maximum read limit', { session_id: 's', limit: 200 }, { session_id: 's', offset: 1, limit: 200 }],
    ['trims surrounding session whitespace', { session_id: '  alpha  ' }, { session_id: 'alpha', offset: 1, limit: 200 }],
    ['trims whitespace without changing offset', { session_id: '  alpha  ', offset: 3 }, { session_id: 'alpha', offset: 3, limit: 200 }],
    ['accepts recent count 1', undefined, undefined],
    ['accepts recent count 50', undefined, undefined],
    ['accepts recent count 200', undefined, undefined],
    ['accepts the maximum safe recent count', undefined, undefined],
    ['prints the session heading', undefined, undefined],
    ['prints a user role label', undefined, undefined],
    ['prints a model role label', undefined, undefined],
    ['prints a tool source label', undefined, undefined],
    ['prints a plugin source label', undefined, undefined],
    ['falls back to the role for unknown source kinds', undefined, undefined],
    ['falls back to MESSAGE without a role', undefined, undefined],
    ['prints the empty message marker', undefined, undefined],
    ['prints the empty-window marker', undefined, undefined],
    ['prints text content', undefined, undefined],
    ['prints reasoning content', undefined, undefined],
    ['prints a tool call name', undefined, undefined],
    ['keeps invalid tool arguments readable', undefined, undefined],
    ['prints the empty tool-result marker', undefined, undefined],
    ['marks an error tool result', undefined, undefined],
    ['prints the end-of-session footer', undefined, undefined],
  ])('$0', (name, args, expected) => {
    if (name === 'accepts recent count 1') return expect(() => validateRecentN(1)).not.toThrow()
    if (name === 'accepts recent count 50') return expect(() => validateRecentN(50)).not.toThrow()
    if (name === 'accepts recent count 200') return expect(() => validateRecentN(200)).not.toThrow()
    if (name === 'accepts the maximum safe recent count') {
      return expect(() => validateRecentN(Number.MAX_SAFE_INTEGER)).not.toThrow()
    }
    if (name === 'prints the session heading') {
      return expect(readOutput([])).toContain('Session session-basic')
    }
    if (name === 'prints a user role label') {
      return expect(readOutput([message()])).toContain('[USER]')
    }
    if (name === 'prints a model role label') {
      return expect(readOutput([message({ role: 'assistant', source: { kind: 'model' } })])).toContain('[ASSISTANT]')
    }
    if (name === 'prints a tool source label') {
      return expect(readOutput([message({ role: 'assistant', source: { kind: 'tool' } })])).toContain('[TOOL]')
    }
    if (name === 'prints a plugin source label') {
      return expect(readOutput([message({ role: 'user', source: { kind: 'plugin' } })])).toContain('[CONTEXT]')
    }
    if (name === 'falls back to the role for unknown source kinds') {
      return expect(readOutput([message({ role: 'system', source: { kind: 'other' } })])).toContain('[SYSTEM]')
    }
    if (name === 'falls back to MESSAGE without a role') {
      return expect(readOutput([message({ role: undefined, source: undefined })])).toContain('[MESSAGE]')
    }
    if (name === 'prints the empty message marker') {
      return expect(readOutput([message({ content: [] })])).toContain('(Empty message)')
    }
    if (name === 'prints the empty-window marker') {
      return expect(readOutput([])).toContain('(No messages in this window)')
    }
    if (name === 'prints text content') {
      return expect(readOutput([message()])).toContain('hello')
    }
    if (name === 'prints reasoning content') {
      return expect(readOutput([message({ content: [{ type: 'reasoning', text: 'thinking' }] })])).toContain('thinking')
    }
    if (name === 'prints a tool call name') {
      return expect(readOutput([message({ content: [{ type: 'tool-call', name: 'session_status', arguments: '{}' }] })])).toContain('Tool call: session_status')
    }
    if (name === 'keeps invalid tool arguments readable') {
      return expect(readOutput([message({ content: [{ type: 'tool-call', name: 'x', arguments: 'not-json' }] })])).toContain('not-json')
    }
    if (name === 'prints the empty tool-result marker') {
      return expect(readOutput([message({ content: [{ type: 'tool-result', content: [] }] })])).toContain('(Empty result)')
    }
    if (name === 'marks an error tool result') {
      return expect(readOutput([message({ content: [{ type: 'tool-result', isError: true, content: [] }] })])).toContain('Tool result (error)')
    }
    if (name === 'prints the end-of-session footer') {
      return expect(readOutput([message()])).toContain('(End of session - total 1 messages)')
    }
    expect(parseReadSessionArgs(args as never)).toEqual(expected)
  })
})

describe('basic and shared methods: MEDIUM cases', () => {
  it.each([
    ['accepts a safe offset near the upper bound', { session_id: 's', offset: Number.MAX_SAFE_INTEGER }, undefined],
    ['accepts a safe limit before the cap', { session_id: 's', limit: 199 }, undefined],
    ['rejects a fractional recent count', undefined, () => validateRecentN(1.5)],
    ['rejects NaN recent count', undefined, () => validateRecentN(Number.NaN)],
    ['rejects infinite recent count', undefined, () => validateRecentN(Number.POSITIVE_INFINITY)],
    ['rejects negative recent count', undefined, () => validateRecentN(-1)],
    ['rejects zero recent count', undefined, () => validateRecentN(0)],
    ['rejects zero offset', { session_id: 's', offset: 0 }, undefined],
    ['rejects zero limit', { session_id: 's', limit: 0 }, undefined],
    ['rejects fractional offset', { session_id: 's', offset: 1.5 }, undefined],
    ['rejects fractional limit', { session_id: 's', limit: 1.5 }, undefined],
    ['rejects an offset above safe integer range', { session_id: 's', offset: Number.MAX_SAFE_INTEGER + 1 }, undefined],
    ['rejects a limit above the configured cap', { session_id: 's', limit: 201 }, undefined],
    ['rejects an empty session id', { session_id: '' }, undefined],
    ['rejects a whitespace-only session id', { session_id: '   ' }, undefined],
    ['separates multiple formatted messages', undefined, undefined],
    ['shows a middle read window', undefined, undefined],
    ['pretty-prints object tool arguments', undefined, undefined],
    ['formats nested tool-result text', undefined, undefined],
    ['preserves a custom session id in output', undefined, undefined],
  ])('$0', (name, args, callback) => {
    if (callback !== undefined) return expect(callback).toThrow()
    if (name === 'accepts a safe offset near the upper bound') {
      return expect(parseReadSessionArgs(args as never)).toEqual({ session_id: 's', offset: Number.MAX_SAFE_INTEGER, limit: 200 })
    }
    if (name === 'accepts a safe limit before the cap') {
      return expect(parseReadSessionArgs(args as never)).toEqual({ session_id: 's', offset: 1, limit: 199 })
    }
    if (name === 'separates multiple formatted messages') {
      const output = readOutput([message(), message({ id: 'message-2', role: 'assistant', content: [{ type: 'text', text: 'world' }] })])
      return expect(output).toContain('hello\n\n[ASSISTANT]\nworld')
    }
    if (name === 'shows a middle read window') {
      return expect(readOutput([message({ id: 'message-2' })], { offset: 2, total_messages: 4 })).toContain('(Showing messages 2-2 of 4)')
    }
    if (name === 'pretty-prints object tool arguments') {
      const output = readOutput([message({ content: [{ type: 'tool-call', name: 'x', arguments: '{"a":1}' }] })])
      return expect(output).toContain('{\n  "a": 1\n}')
    }
    if (name === 'formats nested tool-result text') {
      return expect(readOutput([message({ content: [{ type: 'tool-result', content: [{ type: 'text', text: 'result' }] }] })])).toContain('Tool result\nresult')
    }
    return expect(readOutput([message()], { session_id: 'session-custom' })).toContain('Session session-custom')
  })
})

describe('basic and shared methods: HARD cases', () => {
  it.each([
    ['rejects a missing session id', { session_id: undefined }, undefined],
    ['rejects a non-string session id', { session_id: 123 }, undefined],
    ['rejects NaN offset', { session_id: 's', offset: Number.NaN }, undefined],
    ['rejects infinite offset', { session_id: 's', offset: Number.POSITIVE_INFINITY }, undefined],
    ['rejects negative offset', { session_id: 's', offset: -1 }, undefined],
    ['rejects NaN limit', { session_id: 's', limit: Number.NaN }, undefined],
    ['rejects infinite limit', { session_id: 's', limit: Number.POSITIVE_INFINITY }, undefined],
    ['rejects a non-number recent count', undefined, () => validateRecentN('50' as never)],
    ['formats mixed known and unknown content blocks', undefined, undefined],
    ['formats JSON-array tool arguments', undefined, undefined],
  ])('$0', (name, args, callback) => {
    if (callback !== undefined) return expect(callback).toThrow('recent_n must be a positive safe integer')
    if (name === 'formats mixed known and unknown content blocks') {
      const output = readOutput([message({ content: [
        { type: 'text', text: 'known' },
        { type: 'custom', value: 42 },
      ] })])
      expect(output).toContain('known')
      return expect(output).toContain('"value": 42')
    }
    if (name === 'formats JSON-array tool arguments') {
      const output = readOutput([message({ content: [{ type: 'tool-call', name: 'x', arguments: '[1,2]' }] })])
      return expect(output).toContain('[\n  1,\n  2\n]')
    }
    expect(() => parseReadSessionArgs(args as never)).toThrow()
  })
})
