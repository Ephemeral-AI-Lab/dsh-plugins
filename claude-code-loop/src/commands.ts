import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { LoopUpdatePatch } from './loop.js'

export type LoopCommand =
  | { name: 'loop_create'; arguments: { title?: string; prompt: string; time_in_seconds: number; allow_steer?: boolean } }
  | { name: 'loop_list'; arguments: Record<string, never> }
  | { name: 'loop_update'; arguments: { id: string } & LoopUpdatePatch }
  | { name: 'loop_delete'; arguments: { id: string } }

const USAGE = 'Usage: /loop <seconds> <prompt> | /loop list | /loop create <json> | /loop update <id> <json> | /loop delete <id>'

export function registerLoopCommand(rootCtx: Context, commandCtx: Context): () => void {
  return commandCtx.commands.register({
    name: 'loop',
    description: 'Create, list, update, or delete a recurring prompt loop.',
    input: { hint: '<seconds> <prompt> | list | create <json> | update <id> <json> | delete <id>' },
    recordInput: false,
    handler: ({ agent, commandId, rawInput, signal }) => {
      const command = parseLoopCommand(rawInput)
      if (command === undefined) return Promise.resolve({ kind: 'error', text: USAGE } satisfies CommandResult)
      return executeLoopTool(rootCtx, agent, commandId, command, signal)
    },
  })
}

export function parseLoopCommand(rawInput: string): LoopCommand | undefined {
  const input = rawInput.trim()
  if (input === 'list') return { name: 'loop_list', arguments: {} }

  const createJsonMatch = /^create\s+([\s\S]+)$/u.exec(input)
  if (createJsonMatch !== null) {
    const value = parseJsonRecord(createJsonMatch[1]!)
    const seconds = value?.time_in_seconds
    const title = value?.title
    const allowSteer = value?.allow_steer
    if (value === undefined || !hasOnlyFields(value, ['title', 'prompt', 'time_in_seconds', 'allow_steer'])
      || typeof value.prompt !== 'string' || typeof seconds !== 'number'
      || !Number.isSafeInteger(seconds) || seconds <= 0 || (title !== undefined && typeof title !== 'string')
      || (allowSteer !== undefined && typeof allowSteer !== 'boolean')) return undefined
    return {
      name: 'loop_create',
      arguments: {
        ...(title === undefined ? {} : { title }),
        prompt: value.prompt,
        time_in_seconds: seconds,
        ...(allowSteer === undefined ? {} : { allow_steer: allowSteer }),
      },
    }
  }

  const updateMatch = /^update\s+(\S+)\s+([\s\S]+)$/u.exec(input)
  if (updateMatch !== null) {
    const value = parseJsonRecord(updateMatch[2]!)
    if (value === undefined || !hasUpdateField(value)
      || !hasOnlyFields(value, ['title', 'prompt', 'time_in_seconds', 'allow_steer'])) return undefined
    const title = value.title
    const prompt = value.prompt
    const seconds = value.time_in_seconds
    const allowSteer = value.allow_steer
    if (title !== undefined && typeof title !== 'string') return undefined
    if (prompt !== undefined && typeof prompt !== 'string') return undefined
    if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0)) return undefined
    if (allowSteer !== undefined && typeof allowSteer !== 'boolean') return undefined
    const id = updateMatch[1]!
    return { name: 'loop_update', arguments: { id, ...value } }
  }

  const deleteMatch = /^delete\s+(\S+)$/u.exec(input)
  if (deleteMatch !== null) {
    const id = deleteMatch[1]!
    return { name: 'loop_delete', arguments: { id } }
  }
  if (input === 'delete' || input.startsWith('delete ')) return undefined

  const createMatch = /^(\S+)\s+([\s\S]+)$/u.exec(input)
  if (createMatch === null) return undefined
  const time = Number(createMatch[1])
  const prompt = createMatch[2]?.trim()
  if (!Number.isSafeInteger(time) || time <= 0 || prompt === undefined || prompt.length === 0) return undefined
  return { name: 'loop_create', arguments: { prompt, time_in_seconds: time } }
}

type JsonRecord = Record<string, unknown>

function parseJsonRecord(input: string): JsonRecord | undefined {
  try {
    const value: unknown = JSON.parse(input)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as JsonRecord
      : undefined
  } catch {
    return undefined
  }
}

function hasUpdateField(value: JsonRecord): boolean {
  return ['title', 'prompt', 'time_in_seconds', 'allow_steer']
    .some(key => Object.hasOwn(value, key))
}

function hasOnlyFields(value: JsonRecord, fields: readonly string[]): boolean {
  return Object.keys(value).every(key => fields.includes(key))
}

async function executeLoopTool(
  rootCtx: Context,
  agent: Agent,
  commandId: string,
  command: LoopCommand,
  signal: AbortSignal,
): Promise<CommandResult> {
  const result = await rootCtx.tools.execute({
    callId: CallId(`loop-command-${commandId}`),
    name: command.name,
    arguments: command.arguments,
    agent,
    signal,
  })
  if (result.isError) return { kind: 'error', text: result.error.message }
  return { kind: 'success', text: result.content.find(block => block.type === 'text')?.text ?? JSON.stringify(result.value) }
}
