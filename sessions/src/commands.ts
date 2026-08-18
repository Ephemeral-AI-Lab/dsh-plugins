import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CreateSessionArgs, ListStatusArgs, ReadSessionArgs, SessionSendArgs, SessionSendMode, SessionStatusView } from './types.js'
import { formatReadSessionOutput } from './read-format.js'
import { SessionCreationService } from './creation-service.js'
import { SessionSendService } from './send-service.js'
import { SessionsService, parseReadSessionArgs, validateRecentN } from './service.js'

const USAGE = 'Usage: /sessions status [SESSION_ID] [--recent N] | /sessions read SESSION_ID [--offset N] [--limit N] | /sessions create PROMPT [--preset ID] [--provider PROVIDER --model MODEL] [--effort LEVEL] [--cwd PATH] | /sessions send SESSION_ID MESSAGE [--mode steer|followup]'

export type SessionsCommand =
  | { kind: 'status'; args: ListStatusArgs }
  | { kind: 'read'; args: ReadSessionArgs }
  | { kind: 'create'; args: CreateSessionArgs }
  | { kind: 'send'; args: SessionSendArgs }

export function registerSessionsCommand(
  ctx: Context,
  service: SessionsService,
  creationService?: SessionCreationService,
  sendService?: SessionSendService,
): () => void {
  return ctx.commands.register({
    name: 'sessions',
    description: 'List session status, read, create, or send messages to sessions.',
    input: { hint: 'status [SESSION_ID] [--recent N] | read SESSION_ID [--offset N] [--limit N] | create PROMPT [--preset ID] [--provider PROVIDER --model MODEL] [--effort LEVEL] [--cwd PATH] | send SESSION_ID MESSAGE [--mode steer|followup]' },
    recordInput: false,
    handler: async ({ agent, rawInput, signal }): Promise<CommandResult> => {
      const command = parseSessionsCommand(rawInput)
      if (command === undefined) return { kind: 'error', text: USAGE }

      try {
        if (command.kind === 'status') {
          const result = await service.listStatus(command.args, signal)
          const session = result.sessions[0]
          return {
            kind: 'success',
            text: command.args.session_id !== undefined && session !== undefined
              ? formatStatus(session)
              : formatSessions(result),
          }
        }
        if (command.kind === 'read') {
          return { kind: 'success', text: formatReadSessionOutput(await service.readSession(command.args, signal)) }
        }
        if (command.kind === 'send') {
          if (sendService === undefined) return { kind: 'error', text: 'Session sending is unavailable.' }
          return { kind: 'success', text: JSON.stringify(await sendService.send(command.args, agent, signal)) }
        }
        if (creationService === undefined) return { kind: 'error', text: 'Session creation is unavailable.' }
        return { kind: 'success', text: JSON.stringify(await creationService.createSession(command.args, agent, signal)) }
      } catch (error: unknown) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

export function parseSessionsCommand(rawInput: string): SessionsCommand | undefined {
  const input = rawInput.trim()

  const createMatch = /^create(?:\s+([\s\S]*))?$/u.exec(input)
  if (createMatch !== null) {
    const args = parseCreateSessionArgs(createMatch[1] ?? '')
    return args === undefined ? undefined : { kind: 'create', args }
  }

  const statusMatch = /^status(?:\s+([\s\S]*))?$/u.exec(input)
  if (statusMatch !== null) {
    const args = parseStatusArgs(statusMatch[1] ?? '')
    return args === undefined ? undefined : { kind: 'status', args }
  }

  const readMatch = /^read\s+(\S+)(?:\s+(.*))?$/u.exec(input)
  if (readMatch !== null) {
    const args: ReadSessionArgs = { session_id: readMatch[1]! }
    if (!parseReadOptions(readMatch[2] ?? '', args)) return undefined
    try {
      parseReadSessionArgs(args)
    } catch {
      return undefined
    }
    return { kind: 'read', args }
  }

  const sendMatch = /^send(?:\s+([\s\S]*))?$/u.exec(input)
  if (sendMatch !== null) {
    const args = parseSendSessionArgs(sendMatch[1] ?? '')
    return args === undefined ? undefined : { kind: 'send', args }
  }

  return undefined
}

function parseStatusArgs(rawOptions: string): ListStatusArgs | undefined {
  const tokens = rawOptions.trim() === '' ? [] : rawOptions.trim().split(/\s+/u)
  let sessionId: string | undefined
  let recentN: number | undefined

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const equals = token.indexOf('=')
    const name = equals < 0 ? token : token.slice(0, equals)
    if (name === '--recent' || name === '--recent-n') {
      if (recentN !== undefined) return undefined
      const rawValue = equals < 0 ? tokens[index + 1] : token.slice(equals + 1)
      if (rawValue === undefined || !/^\d+$/u.test(rawValue)) return undefined
      if (equals < 0) index += 1
      recentN = Number(rawValue)
      continue
    }
    if (token.startsWith('--') || sessionId !== undefined) return undefined
    sessionId = token
  }

  try {
    validateRecentN(recentN)
  } catch {
    return undefined
  }
  return {
    ...sessionId === undefined ? {} : { session_id: sessionId },
    ...recentN === undefined ? {} : { recent_n: recentN },
  }
}

export function parseSendSessionArgs(rawInput: string): SessionSendArgs | undefined {
  const tokens = tokenize(rawInput.trim())
  if (tokens === undefined || tokens.length < 2) return undefined

  const sessionId = tokens[0]!
  const messageParts: string[] = []
  let mode: SessionSendMode | undefined

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '--') {
      messageParts.push(...tokens.slice(index + 1))
      break
    }

    const equals = token.indexOf('=')
    const name = equals < 0 ? token : token.slice(0, equals)
    if (name === '--mode') {
      if (mode !== undefined) return undefined
      const value = equals < 0 ? tokens[index + 1] : token.slice(equals + 1)
      if (value === undefined || value.length === 0 || (equals < 0 && value.startsWith('--'))) return undefined
      if (value !== 'steer' && value !== 'followup') return undefined
      if (equals < 0) index += 1
      mode = value
      continue
    }
    if (token.startsWith('--')) return undefined
    messageParts.push(token)
  }

  const message = messageParts.join(' ')
  if (message.trim().length === 0) return undefined
  return {
    session_id: sessionId,
    message,
    ...mode === undefined ? {} : { mode },
  }
}

/**
 * Parse the human-facing create form. Model routing uses separate
 * `--provider PROVIDER --model MODEL` flags. A JSON object with the same shape
 * as the tool arguments is accepted as a convenient machine-friendly form.
 */
export function parseCreateSessionArgs(rawInput: string): CreateSessionArgs | undefined {
  const input = rawInput.trim()
  if (input.startsWith('{')) return parseCreateSessionJson(input)

  const tokens = tokenize(input)
  if (tokens === undefined || tokens.length === 0) return undefined

  const positional: string[] = []
  let promptOption: string | undefined
  let preset: string | undefined
  let provider: string | undefined
  let modelName: string | undefined
  let reasoningEffort: string | undefined
  let cwd: string | undefined
  const seen = new Set<string>()

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '--') {
      positional.push(...tokens.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const equals = token.indexOf('=')
    const name = equals < 0 ? token : token.slice(0, equals)
    const canonicalName = name === '--effort' ? '--reasoning-effort' : name
    if (canonicalName !== '--prompt' && canonicalName !== '--preset' && canonicalName !== '--provider'
      && canonicalName !== '--model' && canonicalName !== '--reasoning-effort' && canonicalName !== '--cwd') {
      return undefined
    }
    if (seen.has(canonicalName)) return undefined
    seen.add(canonicalName)

    let value = equals < 0 ? undefined : token.slice(equals + 1)
    if (value === undefined) {
      value = tokens[index + 1]
      if (value === undefined || value.startsWith('--')) return undefined
      index += 1
    }
    if (value.trim().length === 0) return undefined

    if (canonicalName === '--prompt') promptOption = value
    else if (canonicalName === '--preset') preset = value
    else if (canonicalName === '--provider') provider = value
    else if (canonicalName === '--model') modelName = value
    else if (canonicalName === '--reasoning-effort') reasoningEffort = value
    else cwd = value
  }

  if (promptOption !== undefined && positional.length > 0) return undefined
  const prompt = promptOption ?? positional.join(' ')
  if (prompt.trim().length === 0) return undefined

  const args: CreateSessionArgs = { prompt }
  if (preset !== undefined) args.preset = preset
  if (cwd !== undefined) args.cwd = cwd
  if (modelName !== undefined || provider !== undefined) {
    if (modelName === undefined || provider === undefined) return undefined
    args.model = {
      provider,
      model: modelName,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }
  } else if (provider !== undefined || reasoningEffort !== undefined) {
    return undefined
  }
  return args
}

function parseCreateSessionJson(input: string): CreateSessionArgs | undefined {
  let value: unknown
  try {
    value = JSON.parse(input) as unknown
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const allowed = new Set(['prompt', 'preset', 'model', 'cwd'])
  if (Object.keys(value).some(key => !allowed.has(key)) || typeof value.prompt !== 'string' || value.prompt.trim().length === 0) {
    return undefined
  }

  const args: CreateSessionArgs = { prompt: value.prompt }
  if (value.preset !== undefined) {
    if (typeof value.preset !== 'string' || value.preset.trim().length === 0) return undefined
    args.preset = value.preset
  }
  if (value.cwd !== undefined) {
    if (typeof value.cwd !== 'string' || value.cwd.trim().length === 0) return undefined
    args.cwd = value.cwd
  }
  if (value.model !== undefined) {
    if (!isRecord(value.model)
      || typeof value.model.provider !== 'string'
      || typeof value.model.model !== 'string'
      || value.model.provider.trim().length === 0
      || value.model.model.trim().length === 0
      || (value.model.reasoningEffort !== undefined
        && (typeof value.model.reasoningEffort !== 'string' || value.model.reasoningEffort.trim().length === 0))
      || Object.keys(value.model).some(key => key !== 'provider' && key !== 'model' && key !== 'reasoningEffort')) {
      return undefined
    }
    args.model = {
      provider: value.model.provider,
      model: value.model.model,
      ...value.model.reasoningEffort === undefined ? {} : { reasoningEffort: value.model.reasoningEffort },
    }
  }
  return args
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenize(input: string): string[] | undefined {
  const tokens: string[] = []
  let token = ''
  let started = false
  let quote: 'single' | 'double' | undefined

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!
    if (quote === 'single') {
      if (character === "'") quote = undefined
      else token += character
      continue
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = undefined
      } else {
        token += character
      }
      continue
    }
    if (character === "'") {
      quote = 'single'
      started = true
    } else if (character === '"') {
      quote = 'double'
      started = true
    } else if (/\s/u.test(character)) {
      if (started) {
        tokens.push(token)
        token = ''
        started = false
      }
    } else {
      token += character
      started = true
    }
  }
  if (quote !== undefined) return undefined
  if (started) tokens.push(token)
  return tokens
}

function parseReadOptions(rawOptions: string, args: ReadSessionArgs): boolean {
  const tokens = rawOptions.trim() === '' ? [] : rawOptions.trim().split(/\s+/u)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const inline = /^(--offset|--limit)=(\d+)$/u.exec(token)
    if (inline !== null) {
      if (!setReadOption(args, inline[1]!, Number(inline[2]))) return false
      continue
    }

    if (token !== '--offset' && token !== '--limit') return false
    const value = tokens[index + 1]
    if (value === undefined || !/^\d+$/u.test(value)) return false
    if (!setReadOption(args, token, Number(value))) return false
    index += 1
  }
  return true
}

function setReadOption(args: ReadSessionArgs, name: string, value: number): boolean {
  if (name === '--offset') {
    if (args.offset !== undefined) return false
    args.offset = value
    return true
  }
  if (name === '--limit') {
    if (args.limit !== undefined) return false
    args.limit = value
    return true
  }
  return false
}

function formatSessions(result: { sessions: readonly SessionRow[] }): string {
  if (result.sessions.length === 0) return 'No sessions found.'
  return result.sessions.map(session => {
    const label = session.title ?? session.session_id
    return `${label} · ${session.status} · ${session.updated_at} · ${session.session_id}`
  }).join('\n')
}

function formatStatus(session: SessionStatusView): string {
  const label = session.title ?? session.session_id
  const updated = session.updated_at === undefined ? '' : ` · ${session.updated_at}`
  return `${label} · ${session.status}${updated} · ${session.session_id}`
}

interface SessionRow {
  session_id: string
  title?: string
  status: string
  updated_at?: string
}
