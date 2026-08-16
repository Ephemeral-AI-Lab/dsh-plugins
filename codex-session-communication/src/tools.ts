import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionCommunicationService } from './session-communication.js'

interface WaitSessionsArgs {
  session_ids: string[]
  after?: Record<string, number>
  timeout_ms?: number
}

interface ReadSessionArgs {
  session_id: string
  after_seq?: number
  limit?: number
}

interface ListSessionsArgs {
  limit?: number
}

const SESSION_STATUS = ['running', 'idle', 'cold', 'missing', 'error'] as const

const SESSION_SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: [...SESSION_STATUS] },
    last_seq: { type: 'integer', required: true },
    changed: { type: 'boolean', required: true },
  },
} as const

const SESSION_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['running', 'idle', 'cold'] },
    updated_at: { type: 'string', required: true },
  },
} as const

export function registerSessionCommunicationTools(
  ctx: Context,
  service: SessionCommunicationService,
): () => void {
  const cleanups = [
  ctx.tools.register(defineTool({
    name: 'create_session',
    description: 'Create a session and queue its initial prompt.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Initial prompt for the new session.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: { prompt: string }, exec) {
      requireText(args.prompt, 'prompt')
      return service.createSession(args.prompt, exec.agent)
    },
  })),

  ctx.tools.register(defineTool({
    name: 'send_message_to_session',
    description: 'Queue a text message for an existing session.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session ID returned by create_session.' },
      message: { type: 'string', required: true, description: 'Text message to queue.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: { session_id: string; message: string }, exec) {
      requireText(args.session_id, 'session_id')
      requireText(args.message, 'message')
      return service.sendMessage(args, exec.agent)
    },
  })),

  ctx.tools.register(defineTool({
    name: 'wait_sessions',
    description: 'Wait for durable-event or meaningful state changes in sessions.',
    parameters: {
      session_ids: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Non-empty list of session IDs to observe.',
      },
      after: {
        type: 'object',
        additionalProperties: true,
        description: 'Last observed event sequence per session ID.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Non-negative bounded wait duration. Zero returns immediately.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessions: { type: 'array', required: true, items: SESSION_SNAPSHOT_SCHEMA },
          timed_out: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: WaitSessionsArgs, exec) {
      requireSessionIds(args.session_ids)
      validateTimeout(args.timeout_ms)
      validateAfter(args.after)
      return service.waitSessions(args, exec.signal)
    },
  })),

  ctx.tools.register(defineTool({
    name: 'read_session',
    description: 'Read a durable suffix of a session event log.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session ID to read.' },
      after_seq: { type: 'number', description: 'Exclusive sequence cursor. Defaults to -1.' },
      limit: { type: 'number', description: 'Positive maximum number of events to return.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          events: { type: 'array', required: true, items: { type: 'json' } },
          next_seq: { type: 'integer', required: true },
          has_more: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: ReadSessionArgs) {
      requireText(args.session_id, 'session_id')
      validateAfterSeq(args.after_seq)
      validateLimit(args.limit)
      const result = await service.readSession(args)
      return { ...result, events: result.events as unknown as JsonValue[] }
    },
  })),

  ctx.tools.register(defineTool({
    name: 'list_sessions',
    description: 'List session metadata without loading or resuming sessions.',
    parameters: {
      limit: { type: 'number', description: 'Positive maximum number of sessions to return.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessions: { type: 'array', required: true, items: SESSION_SUMMARY_SCHEMA },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args: ListSessionsArgs) {
      validateLimit(args.limit)
      return service.listSessions(args)
    },
  })),
  ]

  return () => {
    for (const cleanup of [...cleanups].reverse()) cleanup()
  }
}

function requireText(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

function requireSessionIds(sessionIds: string[]): void {
  if (sessionIds.length === 0) throw new Error('session_ids must not be empty')
  for (const sessionId of sessionIds) requireText(sessionId, 'session_id')
}

function validateAfter(after: Record<string, number> | undefined): void {
  if (after === undefined) return
  for (const [sessionId, sequence] of Object.entries(after)) {
    requireText(sessionId, 'session_id')
    if (!Number.isSafeInteger(sequence) || sequence < -1) {
      throw new Error('after sequence values must be safe integers greater than or equal to -1')
    }
  }
}

function validateAfterSeq(afterSeq: number | undefined): void {
  if (afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < -1)) {
    throw new Error('after_seq must be a safe integer greater than or equal to -1')
  }
}

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error('limit must be a positive safe integer')
  }
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)) {
    throw new Error('timeout_ms must be a non-negative safe integer')
  }
}

function renderJson(value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value) ?? '' }]
}
