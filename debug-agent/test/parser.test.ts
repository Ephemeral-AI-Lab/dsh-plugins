import { describe, expect, it } from 'vitest'
import { DebugCommandParseError, parseToolCall } from '../src/parser.js'

describe('debug command parser', () => {
  it('parses an explicit empty JSON object', () => {
    expect(parseToolCall('tool_a({})')).toEqual({ name: 'tool_a', arguments: {} })
    expect(() => parseToolCall(' tool_a() ')).toThrow(DebugCommandParseError)
  })

  it('parses JSON values without evaluating them', () => {
    expect(parseToolCall('tool_a({"x":1,"nested":{"items":[true,null]}})')).toEqual({
      name: 'tool_a',
      arguments: { x: 1, nested: { items: [true, null] } },
    })
  })

  it('accepts surrounding and internal whitespace', () => {
    expect(parseToolCall('  tool_a ( { "x": 1 } )  ')).toEqual({
      name: 'tool_a',
      arguments: { x: 1 },
    })
  })

  it.each([
    'tool_a({x:1})',
    "tool_a({'x':1})",
    'tool_a({"x":1}) trailing',
    'tool_a({"x":1}); tool_b({})',
    'tool_a({"x": foo()})',
    'tool_a({}) extra',
    'tool_a({',
    'tool_a({"x":1}',
    '({})',
    'tool_a([])',
    'tool_a(null)',
  ])('rejects malformed input %s', (input) => {
    expect(() => parseToolCall(input)).toThrow(DebugCommandParseError)
  })

  it('accepts an unknown but syntactically valid tool name', () => {
    expect(parseToolCall('does_not_exist({})').name).toBe('does_not_exist')
    expect(parseToolCall('tool-name({})').name).toBe('tool-name')
  })
})
