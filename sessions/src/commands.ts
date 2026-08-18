import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ListSessionsArgs, ReadSessionArgs, SessionStatusView } from './types.js'
import { formatReadSessionOutput } from './read-format.js'
import { SessionsService, parseReadSessionArgs, validateLimit } from './service.js'

const USAGE = 'Usage: /sessions list [--limit N] | /sessions status SESSION_ID | /sessions read SESSION_ID [--offset N] [--limit N]'

export type SessionsCommand =
  | { kind: 'list'; args: ListSessionsArgs }
  | { kind: 'status'; session_id: string }
  | { kind: 'read'; args: ReadSessionArgs }

export function registerSessionsCommand(ctx: Context, service: SessionsService): () => void {
  return ctx.commands.register({
    name: 'sessions',
    description: 'List, inspect, or read sessions.',
    input: { hint: 'list [--limit N] | status SESSION_ID | read SESSION_ID [--offset N] [--limit N]' },
    recordInput: false,
    handler: async ({ rawInput, signal }): Promise<CommandResult> => {
      const command = parseSessionsCommand(rawInput)
      if (command === undefined) return { kind: 'error', text: USAGE }

      try {
        if (command.kind === 'list') {
          return { kind: 'success', text: formatSessions(await service.listSessions(command.args, signal)) }
        }
        if (command.kind === 'status') {
          return { kind: 'success', text: formatStatus(await service.checkSessionStatus({ session_id: command.session_id }, signal)) }
        }
        return { kind: 'success', text: formatReadSessionOutput(await service.readSession(command.args, signal)) }
      } catch (error: unknown) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

export function parseSessionsCommand(rawInput: string): SessionsCommand | undefined {
  const input = rawInput.trim()
  if (input === 'list') return { kind: 'list', args: {} }

  const listMatch = /^list\s+--limit(?:\s+|=)(\d+)$/u.exec(input)
  if (listMatch !== null) {
    const limit = Number(listMatch[1])
    try {
      validateLimit(limit)
    } catch {
      return undefined
    }
    return { kind: 'list', args: { limit } }
  }

  const statusMatch = /^status\s+(\S+)$/u.exec(input)
  if (statusMatch !== null) return { kind: 'status', session_id: statusMatch[1]! }

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

  return undefined
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
  updated_at: string
}
