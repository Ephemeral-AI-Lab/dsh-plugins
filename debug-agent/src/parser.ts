/** Strict, JSON-only parsing for the public `/debug` command surface. */

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

export interface ParsedToolCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface DebugRunCommand {
  readonly kind: 'run'
  readonly calls: readonly ParsedToolCall[]
}

export interface DebugReplayCommand {
  readonly kind: 'replay'
  readonly path: string
  readonly overwriteWaitTimeMs?: number
}

export type ParsedDebugCommand = DebugRunCommand | DebugReplayCommand

export class DebugCommandParseError extends Error {
  readonly code = 'INVALID_COMMAND'

  constructor(message: string) {
    super(message)
    this.name = 'DebugCommandParseError'
  }
}

/** The tool-name grammar shared by command and canonical-script validation. */
export function isDebugToolName(value: string): boolean {
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
    throw new DebugCommandParseError('expected exactly one tool call')
  }
  return parsed.call
}

/** Parse `/debug run ...` or `/debug replay ...` in its entirety. */
export function parseDebugCommand(input: string): ParsedDebugCommand {
  const text = input.trim()
  if (!text.startsWith('/debug')) {
    throw new DebugCommandParseError('command must start with /debug')
  }

  const rest = text.slice('/debug'.length)
  if (rest.length === 0 || !/^[\t\n\r ]/.test(rest)) {
    throw new DebugCommandParseError('expected `run` or `replay` after /debug')
  }
  const body = rest.trimStart()
  if (body.startsWith('run')) return parseRunCommand(body)
  if (body.startsWith('replay')) return parseReplayCommand(body)
  throw new DebugCommandParseError('expected `run` or `replay` after /debug')
}

/** Parse the single-call or one-parallel-group `/debug run` grammar. */
export function parseRunCommand(input: string): DebugRunCommand {
  const match = /^run(?=[\t\n\r ]|$)/.exec(input)
  if (match === null) throw new DebugCommandParseError('expected /debug run')
  let cursor = match[0].length
  cursor = skipWhitespace(input, cursor)
  if (cursor >= input.length) {
    throw new DebugCommandParseError('expected one tool call')
  }

  if (input[cursor] === '[') {
    cursor += 1
    const calls: ParsedToolCall[] = []
    while (true) {
      cursor = skipWhitespace(input, cursor)
      if (cursor >= input.length) throw new DebugCommandParseError('unterminated parallel group')
      if (input[cursor] === ']') {
        if (calls.length === 0) throw new DebugCommandParseError('parallel group must not be empty')
        cursor += 1
        break
      }
      const parsed = parseExpressionAt(input, cursor)
      if (parsed.call.name === 'wait') throw new DebugCommandParseError('wait syntax is only valid in canonical replay scripts')
      calls.push(parsed.call)
      cursor = parsed.next
    }
    if (skipWhitespace(input, cursor) !== input.length) {
      throw new DebugCommandParseError('parallel run must contain exactly one bracketed group')
    }
    return { kind: 'run', calls }
  }

  const parsed = parseExpressionAt(input, cursor)
  if (parsed.call.name === 'wait') throw new DebugCommandParseError('wait syntax is only valid in canonical replay scripts')
  if (skipWhitespace(input, parsed.next) !== input.length) {
    throw new DebugCommandParseError('run accepts exactly one tool call or one parallel group')
  }
  return { kind: 'run', calls: [parsed.call] }
}

/** Parse `/debug replay <path> [--overwrite-wait-time-ms <N>]`. */
export function parseReplayCommand(input: string): DebugReplayCommand {
  const match = /^replay(?=[\t\n\r ]|$)/.exec(input)
  if (match === null) throw new DebugCommandParseError('expected /debug replay')
  const tokens = tokenizeReplayArguments(input.slice(match[0].length))
  if (tokens.length === 0) throw new DebugCommandParseError('replay requires a source path')

  const path = tokens[0]
  if (path === undefined || path.length === 0) throw new DebugCommandParseError('replay requires a source path')
  if (tokens.length === 1) return { kind: 'replay', path }
  if (tokens.length !== 3 || tokens[1] !== '--overwrite-wait-time-ms') {
    throw new DebugCommandParseError('replay accepts only --overwrite-wait-time-ms N')
  }
  const rawWait = tokens[2]
  if (rawWait === undefined || !/^\d+$/.test(rawWait)) {
    throw new DebugCommandParseError('overwrite wait time must be a non-negative integer')
  }
  const overwriteWaitTimeMs = Number(rawWait)
  if (!Number.isSafeInteger(overwriteWaitTimeMs)) {
    throw new DebugCommandParseError('overwrite wait time is too large')
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
  if (!isDebugToolName(name)) {
    throw new DebugCommandParseError(`invalid tool name: ${JSON.stringify(name)}`)
  }
  cursor = skipWhitespace(input, cursor)
  if (input[cursor] !== '(') throw new DebugCommandParseError('expected `(` after tool name')
  const open = cursor
  cursor += 1
  const close = findClosingParenthesis(input, cursor)
  if (close < 0) throw new DebugCommandParseError('unterminated tool call')
  const payload = input.slice(open + 1, close).trim()
  if (payload.length === 0) {
    throw new DebugCommandParseError('arguments must be a JSON object')
  }

  let value: unknown
  try {
    value = JSON.parse(payload) as unknown
  } catch {
    throw new DebugCommandParseError('arguments must be valid JSON')
  }
  if (!isJsonObject(value)) {
    throw new DebugCommandParseError('arguments must be a JSON object')
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
          if (next === undefined) throw new DebugCommandParseError('unterminated quoted replay path')
          token += next === '"' || next === '\\' ? next : `\\${next}`
          cursor += 2
          continue
        }
        token += character
        cursor += 1
      }
      if (!closed) throw new DebugCommandParseError('unterminated quoted replay path')
      if (cursor < input.length && !/\s/.test(input[cursor] ?? '')) {
        throw new DebugCommandParseError('replay path must be one argument')
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
