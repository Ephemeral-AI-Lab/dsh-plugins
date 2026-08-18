import { describe, expect, it } from 'vitest'
import { appendReadOption, previewForDraft, READ_OPTIONS } from '../../src/ui/autocomplete.js'
import { formatReadSessionOutput } from '../../src/read-format.js'
import type { ReadSessionMessage, ReadSessionResult } from '../../src/types.js'

const textMessage = (role: string, text: string, source: Record<string, unknown> = { kind: 'user' }): ReadSessionMessage => ({
  id: `${role}-${text}`,
  role,
  content: [{ type: 'text', text }],
  source,
}) as ReadSessionMessage

const rawMessage = (content: unknown, extra: Record<string, unknown> = {}): ReadSessionMessage => ({
  id: 'raw-message',
  role: 'assistant',
  content,
  source: { kind: 'model', provider: 'mock', model: 'mock' },
  ...extra,
}) as ReadSessionMessage

const readResult = (
  messages: ReadSessionMessage[],
  options: Partial<Pick<ReadSessionResult, 'session_id' | 'offset' | 'total_messages'>> = {},
): ReadSessionResult => ({
  session_id: 'ui-session',
  offset: 1,
  total_messages: messages.length,
  ...options,
  messages,
})

const easyCases: Array<[string, string, unknown]> = [
  ['[E01] recognizes status', '/sessions status', { kind: 'status' }],
  ['[E02] recognizes status with trailing spaces', '/sessions status   ', { kind: 'status' }],
  ['[E03] trims leading spaces', '  /sessions status', { kind: 'status' }],
  ['[E04] recognizes read without an id', '/sessions read', { kind: 'read' }],
  ['[E05] recognizes read with a trailing space', '/sessions read ', { kind: 'read' }],
  ['[E06] accepts repeated command spaces', '/sessions    read   ', { kind: 'read' }],
  ['[E07] previews a simple session id', '/sessions read alpha', { kind: 'read-options', sessionId: 'alpha', options: READ_OPTIONS }],
  ['[E08] preserves a numeric session id', '/sessions read 42', { kind: 'read-options', sessionId: '42', options: READ_OPTIONS }],
  ['[E09] preserves a dotted session id', '/sessions read run.2026.08', { kind: 'read-options', sessionId: 'run.2026.08', options: READ_OPTIONS }],
  ['[E10] preserves a hyphenated session id', '/sessions read session-a-b', { kind: 'read-options', sessionId: 'session-a-b', options: READ_OPTIONS }],
  ['[E11] returns undefined for an unrelated command', '/session status', undefined],
  ['[E12] returns undefined for an unknown sessions command', '/sessions delete alpha', undefined],
  ['[E13] returns undefined for plain text', 'hello world', undefined],
  ['[E14] rejects a case-changed command', '/Sessions status', undefined],
  ['[E15] rejects a missing slash', 'sessions status', undefined],
  ['[E16] offers both options for a fresh id', '/sessions read fresh-id', { kind: 'read-options', sessionId: 'fresh-id', options: READ_OPTIONS }],
  ['[E17] accepts an id containing an underscore', '/sessions read build_7', { kind: 'read-options', sessionId: 'build_7', options: READ_OPTIONS }],
  ['[E18] accepts an id containing a colon', '/sessions read task:7', { kind: 'read-options', sessionId: 'task:7', options: READ_OPTIONS }],
  ['[E19] ignores a blank command draft', '   ', undefined],
  ['[E20] keeps a read preview after newline-free whitespace', '/sessions read\t', { kind: 'read' }],
  ['[E21] renders a user text message', 'format-user', 'Session ui-session\n[USER]\nhello\n\n(End of session - total 1 messages)'],
  ['[E22] renders an assistant label in uppercase', 'format-assistant', '[ASSISTANT]\nanswer'],
  ['[E23] renders an empty message marker', 'format-empty', '[ASSISTANT]\n(Empty message)'],
  ['[E24] renders an empty window marker', 'format-window', '(No messages in this window)'],
  ['[E25] renders the end footer', 'format-end-footer', '(End of session - total 1 messages)'],
  ['[E26] renders a partial-window footer', 'format-partial-footer', '(Showing messages 2-2 of 4)'],
  ['[E27] separates two messages with a blank line', 'format-separator', '[USER]\none\n\n[ASSISTANT]\ntwo'],
  ['[E28] labels tool-source messages as tool', 'format-tool-label', '[TOOL]\ntool output'],
  ['[E29] labels plugin-source messages as context', 'format-plugin-label', '[CONTEXT]\ncontext'],
  ['[E30] falls back to MESSAGE for a non-string role', 'format-role-fallback', '[MESSAGE]\nvalue'],
]

const easyAutocompleteCases = easyCases.slice(0, 20)
const easyFormattingCases = easyCases.slice(20)

const mediumCases: Array<[string, string, unknown]> = [
  ['[M01] filters the offset option by its prefix', '/sessions read alpha --o', { kind: 'read-options', sessionId: 'alpha', options: [READ_OPTIONS[0]] }],
  ['[M02] filters the limit option by its prefix', '/sessions read alpha --l', { kind: 'read-options', sessionId: 'alpha', options: [READ_OPTIONS[1]] }],
  ['[M03] removes an offset already supplied', '/sessions read alpha --offset 3', { kind: 'read-options', sessionId: 'alpha', options: [READ_OPTIONS[1]] }],
  ['[M04] removes a limit already supplied', '/sessions read alpha --limit 3', { kind: 'read-options', sessionId: 'alpha', options: [READ_OPTIONS[0]] }],
  ['[M05] closes for an equals-form offset token', '/sessions read alpha --offset=3', undefined],
  ['[M06] closes for an equals-form limit token', '/sessions read alpha --limit=3', undefined],
  ['[M07] closes after both options are used', '/sessions read alpha --offset=3 --limit=4', undefined],
  ['[M08] closes for an unmatched partial option', '/sessions read alpha --unknown', undefined],
  ['[M09] leaves offset after a used limit and partial offset', '/sessions read alpha --limit 4 --o', { kind: 'read-options', sessionId: 'alpha', options: [READ_OPTIONS[0]] }],
  ['[M10] handles extra spaces before a flag', '/sessions read alpha   --offset 3', { kind: 'read-options', sessionId: 'alpha', options: [READ_OPTIONS[1]] }],
]

const mediumAppendCases: Array<[string, string, '--offset' | '--limit', string]> = [
  ['[M11] appends an option to a clean draft', '/sessions read alpha', '--limit', '/sessions read alpha --limit '],
  ['[M12] replaces a partial option token', '/sessions read alpha --li', '--limit', '/sessions read alpha --limit '],
  ['[M13] replaces a bare option token', '/sessions read alpha --', '--offset', '/sessions read alpha --offset '],
  ['[M14] trims trailing spaces before appending', '/sessions read alpha   ', '--limit', '/sessions read alpha --limit '],
  ['[M15] preserves the command prefix while appending', '/sessions read alpha --offset 2', '--limit', '/sessions read alpha --offset 2 --limit '],
]

const mediumFormattingCases: Array<[string, string, string]> = [
  ['[M16] renders a reasoning block as text', 'format-reasoning', '[ASSISTANT]\nthinking'],
  ['[M17] pretty-prints valid tool arguments', 'format-tool-args', '"x": 1'],
  ['[M18] preserves invalid tool arguments', 'format-invalid-tool-args', 'not-json'],
  ['[M19] renders an empty tool result', 'format-empty-tool-result', 'Tool result\n(Empty result)'],
  ['[M20] marks an error tool result', 'format-error-tool-result', 'Tool result (error)'],
]

const hardCases: Array<[string, string, unknown]> = [
  ['[H01] formats nested tool-result text', 'format-nested-result', 'Tool result\ninner'],
  ['[H02] keeps nested result block order', 'format-result-order', 'first\nsecond'],
  ['[H03] pretty-prints nested tool arguments', 'format-nested-args', '"query": "status"'],
  ['[H04] serializes an unknown content block', 'format-unknown-block', '"type": "future"'],
  ['[H05] serializes a malformed tool-call shape', 'format-malformed-call', '"type": "tool-call"'],
  ['[H06] renders a non-array result content as empty', 'format-invalid-result-content', 'Tool result\n(Empty result)'],
  ['[H07] renders a non-array message content as empty', 'format-invalid-message-content', '[ASSISTANT]\n(Empty message)'],
  ['[H08] keeps duplicate message ids renderable', 'format-duplicate-ids', '[USER]\nfirst\n\n[USER]\nsecond'],
  ['[H09] applies plugin context over the role label', 'format-plugin-role-precedence', '[CONTEXT]\nmetadata'],
  ['[H10] closes a window exactly at its total', 'format-exact-window-end', '(End of session - total 4 messages)'],
]

describe('sessions UI, autocomplete, and formatting edge cases', () => {
  it.each(easyAutocompleteCases)('%s', (_label, input, expected) => {
    expect(previewForDraft(input)).toEqual(expected)
  })

  it.each(easyFormattingCases)('%s', (_label, kind, expected) => {
    expect(formattingCase(kind)).toContain(expected as string)
  })

  it.each(mediumCases)('%s', (_label, input, expected, value) => {
    expect(previewForDraft(input)).toEqual(expected)
  })

  it.each(mediumAppendCases)('%s', (_label, draft, flag, expected) => {
    expect(appendReadOption(draft, flag)).toBe(expected)
  })

  it.each(mediumFormattingCases)('%s', (_label, kind, expected) => {
    expect(formattingCase(kind)).toContain(expected)
  })

  it.each(hardCases)('%s', (_label, kind, expected) => {
    expect(formattingCase(kind)).toContain(expected as string)
  })
})

function formattingCase(kind: string): string {
  switch (kind) {
    case 'format-user':
      return formatReadSessionOutput(readResult([textMessage('user', 'hello')]))
    case 'format-assistant':
      return formatReadSessionOutput(readResult([textMessage('assistant', 'answer', { kind: 'model' })]))
    case 'format-empty':
      return formatReadSessionOutput(readResult([rawMessage([])]))
    case 'format-window':
      return formatReadSessionOutput(readResult([]))
    case 'format-end-footer':
      return formatReadSessionOutput(readResult([textMessage('user', 'hello')]))
    case 'format-partial-footer':
      return formatReadSessionOutput(readResult([textMessage('user', 'hello')], { offset: 2, total_messages: 4 }))
    case 'format-separator':
      return formatReadSessionOutput(readResult([textMessage('user', 'one'), textMessage('assistant', 'two', { kind: 'model' })]))
    case 'format-tool-label':
      return formatReadSessionOutput(readResult([textMessage('assistant', 'tool output', { kind: 'tool' })]))
    case 'format-plugin-label':
      return formatReadSessionOutput(readResult([textMessage('assistant', 'context', { kind: 'plugin' })]))
    case 'format-role-fallback':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'text', text: 'value' }], { role: 7 })]))
    case 'format-reasoning':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'reasoning', text: 'thinking' }])]))
    case 'format-tool-args':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-call', name: 'lookup', arguments: '{"x":1}' }])]))
    case 'format-invalid-tool-args':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-call', name: 'lookup', arguments: 'not-json' }])]))
    case 'format-empty-tool-result':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-result', content: [] }])]))
    case 'format-error-tool-result':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'failed' }] }])]))
    case 'format-nested-result':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-result', content: [{ type: 'text', text: 'inner' }] }])]))
    case 'format-result-order':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-result', content: [{ type: 'text', text: 'first' }, { type: 'reasoning', text: 'second' }] }])]))
    case 'format-nested-args':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-call', name: 'lookup', arguments: '{"query":"status"}' }])]))
    case 'format-unknown-block':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'future', enabled: true }])]))
    case 'format-malformed-call':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-call', name: 7, arguments: '{}' }])]))
    case 'format-invalid-result-content':
      return formatReadSessionOutput(readResult([rawMessage([{ type: 'tool-result', content: 'not-an-array' }])]))
    case 'format-invalid-message-content':
      return formatReadSessionOutput(readResult([rawMessage('not-an-array')]))
    case 'format-duplicate-ids':
      return formatReadSessionOutput(readResult([
        textMessage('user', 'first'),
        { ...textMessage('user', 'second'), id: 'user-first' },
      ]))
    case 'format-plugin-role-precedence':
      return formatReadSessionOutput(readResult([textMessage('assistant', 'metadata', { kind: 'plugin' })]))
    case 'format-exact-window-end':
      return formatReadSessionOutput(readResult([
        textMessage('user', 'one'),
        textMessage('assistant', 'two', { kind: 'model' }),
      ], { offset: 3, total_messages: 4 }))
    default:
      throw new Error(`Unknown formatting case: ${kind}`)
  }
}
