/** Strict, JSON-only parsing for the public `/mock` command surface. */

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

export interface ParsedToolCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface MockRunCommand {
  readonly kind: 'run'
  readonly calls: readonly ParsedToolCall[]
}

export interface MockReplayCommand {
  readonly kind: 'replay'
  readonly path: string
  readonly overwriteWaitTimeMs?: number
}

export type ParsedMockCommand = MockRunCommand | MockReplayCommand

export class MockCommandParseError extends Error {
  readonly code = 'INVALID_COMMAND'

  constructor(message: string) {
    super(message)
    this.name = 'MockCommandParseError'
  }
}

/** The tool-name grammar shared by command and canonical-script validation. */
export function isMockToolName(value: string): boolean {
  return TOOL_NAME.test(value)
}

/**
 * Parse exactly one `tool_name(JSON_OBJECT)` expression.
 *
 * This scanner only locates the outer parentheses. JSON.parse remains the
 * sole parser for the argument data, so JavaScript expressions can never be
 * evaluated accidentally.
 */
export function parseToolCall(input: string): ParsedToolCall {
  const expression = input.trim()
  const parsed = parseExpressionAt(expression, 0)
  if (parsed.next !== expression.length) {
    throw new MockCommandParseError('expected exactly one tool call')
  }
  return parsed.call
}

/** Parse `/mock run ...` or `/mock replay ...` in its entirety. */
export function parseMockCommand(input: string): ParsedMockCommand {
  const text = input.trim()
  if (!text.startsWith('/mock')) {
    throw new MockCommandParseError('command must start with /mock')
  }

  const rest = text.slice('/mock'.length)
  if (rest.length === 0 || !/^[\t\n\r ]/.test(rest)) {
    throw new MockCommandParseError('expected `run` or `replay` after /mock')
  }
  const body = rest.trimStart()
  if (body.startsWith('run')) return parseRunCommand(body)
  if (body.startsWith('replay')) return parseReplayCommand(body)
  throw new MockCommandParseError('expected `run` or `replay` after /mock')
}

/** Parse the single-call or one-parallel-group `/mock run` grammar. */
export function parseRunCommand(input: string): MockRunCommand {
  const match = /^run(?=[\t\n\r ]|$)/.exec(input)
  if (match === null) throw new MockCommandParseError('expected /mock run')
  let cursor = match[0].length
  cursor = skipWhitespace(input, cursor)
  if (cursor >= input.length) {
    throw new MockCommandParseError('expected one tool call')
  }

  if (input[cursor] === '[') {
    cursor += 1
    const calls: ParsedToolCall[] = []
    while (true) {
      cursor = skipWhitespace(input, cursor)
      if (cursor >= input.length) throw new MockCommandParseError('unterminated parallel group')
      if (input[cursor] === ']') {
        if (calls.length === 0) throw new MockCommandParseError('parallel group must not be empty')
        cursor += 1
        break
      }
      const parsed = parseExpressionAt(input, cursor)
      if (parsed.call.name === 'wait') throw new MockCommandParseError('wait syntax is only valid in canonical replay scripts')
      calls.push(parsed.call)
      cursor = parsed.next
    }
    if (skipWhitespace(input, cursor) !== input.length) {
      throw new MockCommandParseError('parallel run must contain exactly one bracketed group')
    }
    return { kind: 'run', calls }
  }

  const parsed = parseExpressionAt(input, cursor)
  if (parsed.call.name === 'wait') throw new MockCommandParseError('wait syntax is only valid in canonical replay scripts')
  if (skipWhitespace(input, parsed.next) !== input.length) {
    throw new MockCommandParseError('run accepts exactly one tool call or one parallel group')
  }
  return { kind: 'run', calls: [parsed.call] }
}

/** Parse `/mock replay <path> [--overwrite-wait-time-ms <N>]`. */
export function parseReplayCommand(input: string): MockReplayCommand {
  const match = /^replay(?=[\t\n\r ]|$)/.exec(input)
  if (match === null) throw new MockCommandParseError('expected /mock replay')
  const tokens = tokenizeReplayArguments(input.slice(match[0].length))
  if (tokens.length === 0) throw new MockCommandParseError('replay requires a source path')

  const path = tokens[0]
  if (path === undefined || path.length === 0) throw new MockCommandParseError('replay requires a source path')
  if (tokens.length === 1) return { kind: 'replay', path }
  if (tokens.length !== 3 || tokens[1] !== '--overwrite-wait-time-ms') {
    throw new MockCommandParseError('replay accepts only --overwrite-wait-time-ms N')
  }
  const rawWait = tokens[2]
  if (rawWait === undefined || !/^\d+$/.test(rawWait)) {
    throw new MockCommandParseError('overwrite wait time must be a non-negative integer')
  }
  const overwriteWaitTimeMs = Number(rawWait)
  if (!Number.isSafeInteger(overwriteWaitTimeMs)) {
    throw new MockCommandParseError('overwrite wait time is too large')
  }
  return { kind: 'replay', path, overwriteWaitTimeMs }
}

interface ParsedExpression {
  readonly call: ParsedToolCall
  readonly next: number
}

function parseExpressionAt(input: string, start: number): ParsedExpression {
  let cursor = skipWhitespace(input, start)
  const nameStart = cursor
  while (cursor < input.length && /[A-Za-z0-9_-]/.test(input[cursor] ?? '')) cursor += 1
  const name = input.slice(nameStart, cursor)
  if (!isMockToolName(name)) {
    throw new MockCommandParseError(`invalid tool name: ${JSON.stringify(name)}`)
  }
  cursor = skipWhitespace(input, cursor)
  if (input[cursor] !== '(') throw new MockCommandParseError('expected `(` after tool name')
  const open = cursor
  cursor += 1
  const close = findClosingParenthesis(input, cursor)
  if (close < 0) throw new MockCommandParseError('unterminated tool call')
  const payload = input.slice(open + 1, close).trim()
  if (payload.length === 0) {
    throw new MockCommandParseError('arguments must be a JSON object')
  }

  let value: unknown
  try {
    value = JSON.parse(payload) as unknown
  } catch {
    throw new MockCommandParseError('arguments must be valid JSON')
  }
  if (!isJsonObject(value)) {
    throw new MockCommandParseError('arguments must be a JSON object')
  }
  return { call: { name, arguments: value }, next: close + 1 }
}

function findClosingParenthesis(input: string, start: number): number {
  let inString = false
  let escaped = false
  for (let cursor = start; cursor < input.length; cursor += 1) {
    const character = input[cursor]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === ')') return cursor
  }
  return -1
}

function tokenizeReplayArguments(input: string): string[] {
  const tokens: string[] = []
  let cursor = 0
  while (cursor < input.length) {
    cursor = skipWhitespace(input, cursor)
    if (cursor >= input.length) break
    const quote = input[cursor]
    if (quote === '"') {
      cursor += 1
      let token = ''
      let closed = false
      while (cursor < input.length) {
        const character = input[cursor]
        if (character === '"') {
          cursor += 1
          closed = true
          break
        }
        if (character === '\\') {
          const next = input[cursor + 1]
          if (next === undefined) throw new MockCommandParseError('unterminated quoted replay path')
          token += next === '"' || next === '\\' ? next : `\\${next}`
          cursor += 2
          continue
        }
        token += character
        cursor += 1
      }
      if (!closed) throw new MockCommandParseError('unterminated quoted replay path')
      if (cursor < input.length && !/\s/.test(input[cursor] ?? '')) {
        throw new MockCommandParseError('replay path must be one argument')
      }
      tokens.push(token)
      continue
    }
    const start = cursor
    while (cursor < input.length && !/\s/.test(input[cursor] ?? '')) cursor += 1
    tokens.push(input.slice(start, cursor))
  }
  return tokens
}

function skipWhitespace(input: string, start: number): number {
  let cursor = start
  while (cursor < input.length && /\s/.test(input[cursor] ?? '')) cursor += 1
  return cursor
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
