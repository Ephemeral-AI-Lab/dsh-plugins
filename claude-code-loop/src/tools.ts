import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  createLoopRecord, flushPersistence, foldLoopEvents, LoopInputError, loopView, updateLoopRecord,
  type LoopRuntime,
} from './loop.js'

interface LoopCreateArgs {
  title?: string
  prompt: string
  time_in_seconds: number
  allow_steer?: boolean
}

interface LoopUpdateArgs {
  id: string
  title?: string
  prompt?: string
  time_in_seconds?: number
  allow_steer?: boolean
}

interface LoopDeleteArgs {
  id: string
}

const LOOP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    time_in_seconds: { type: 'integer', required: true },
    allow_steer: { type: 'boolean', required: true },
    next_at: { type: 'integer', required: true },
    state: { type: 'string', required: true, enum: ['scheduled', 'overdue'] },
    delivery_mode: { type: 'string', required: true, enum: ['session-local'] },
  },
} as const

export function registerLoopTools(
  rootCtx: Context,
  toolCtx: Context,
  agent: Agent,
  runtime: LoopRuntime,
): () => void {
  const disposers = [
    toolCtx.tools.register(defineTool({
      name: 'loop_create',
      description: 'Create a titled, session-scoped recurring prompt loop. time_in_seconds is the only time unit. allow_steer defaults to true.',
      parameters: {
        title: { type: 'string', description: 'Short title shown in the Loops view. Defaults to the first prompt line.' },
        prompt: { type: 'string', required: true, description: 'Prompt delivered on every loop iteration.' },
        time_in_seconds: { type: 'integer', required: true, description: 'Positive safe-integer interval in seconds.' },
        allow_steer: { type: 'boolean', description: 'When true, steer a running agent; defaults to true.' },
      },
      output: { schema: LOOP_SCHEMA, render: renderJson },
      async execute(args: LoopCreateArgs, _exec) {
        return runtime.transact(async () => {
          await flushPersistence(rootCtx, agent)
          const record = createLoopRecord(args.prompt, args.time_in_seconds, args.allow_steer ?? true, Date.now(), undefined, args.title)
          agent.session.append('loop/change', { version: 1, operation: 'create', loop: record })
          await flushPersistence(rootCtx, agent)
          runtime.requestDrive()
          return loopView(record)
        })
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'loop_update',
      description: 'Update one active loop. Changing its interval reschedules its next run; other changes preserve next_at.',
      parameters: {
        id: { type: 'string', required: true, description: 'Loop id returned by loop_create or loop_list.' },
        title: { type: 'string', description: 'New short title.' },
        prompt: { type: 'string', description: 'New recurring prompt.' },
        time_in_seconds: { type: 'integer', description: 'New positive interval in seconds.' },
        allow_steer: { type: 'boolean', description: 'Whether a running agent may receive steer delivery.' },
      },
      output: { schema: LOOP_SCHEMA, render: renderJson },
      async execute(args: LoopUpdateArgs, _exec) {
        if (typeof args.id !== 'string' || args.id.trim().length === 0) throw new LoopInputError('id must be non-empty')
        return runtime.transact(async () => {
          await flushPersistence(rootCtx, agent)
          const folded = fold(agent.session)
          const current = folded.active.find(loop => loop.id === args.id)
          if (current === undefined) throw new LoopInputError(`unknown loop id: ${args.id}`)
          const updated = updateLoopRecord(current, args)
          agent.session.append('loop/change', { version: 1, operation: 'update', loop: updated })
          await flushPersistence(rootCtx, agent)
          runtime.requestDrive()
          return loopView(updated)
        })
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'loop_list',
      description: 'List active loops for the current session.',
      parameters: {},
      output: { schema: { type: 'array', items: LOOP_SCHEMA }, render: renderJson },
      async execute(_args, _exec) {
        return runtime.transact(async () => {
          await flushPersistence(rootCtx, agent)
          return fold(agent.session).active.map(loop => loopView(loop))
        })
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'loop_delete',
      description: 'Delete an active loop by its session-local id.',
      parameters: {
        id: { type: 'string', required: true, description: 'Loop id returned by loop_create.' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { deleted: { type: 'boolean', required: true }, id: { type: 'string', required: true } } }, render: renderJson },
      async execute(args: LoopDeleteArgs, _exec) {
        if (typeof args.id !== 'string' || args.id.trim().length === 0) throw new LoopInputError('id must be non-empty')
        return runtime.transact(async () => {
          await flushPersistence(rootCtx, agent)
          const folded = fold(agent.session)
          if (!folded.active.some(loop => loop.id === args.id)) throw new LoopInputError(`unknown loop id: ${args.id}`)
          agent.session.append('loop/change', { version: 1, operation: 'delete', id: args.id })
          await flushPersistence(rootCtx, agent)
          runtime.requestDrive()
          return { deleted: true, id: args.id }
        })
      },
    })),
  ]

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

function fold(session: Session) {
  return foldLoopEvents(session.events, session.header.seedLength ?? 0)
}

function renderJson(_args: unknown, value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value ?? null) }]
}
