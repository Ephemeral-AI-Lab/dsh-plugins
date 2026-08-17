import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { LoopChange, LoopProjection } from './types.js'
import type {} from '@deepseek-ai/dsh-session/types'

interface LoopProjectionDefinition {
  readonly key: 'claude-code-loop'
  readonly schema: { parse(value: unknown): LoopProjection }
  readonly stateVersion: number
  readonly init: () => LoopProjection
  readonly apply: (state: LoopProjection, event: SessionEvent) => LoopProjection
  readonly view: (state: LoopProjection) => LoopProjection
}

const loopRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  time_in_seconds: z.number().int().positive(),
  allow_steer: z.boolean(),
  next_at: z.number().int().nonnegative(),
}).strict()

const loopProjectionSchema = z.object({
  loops: z.array(loopRecordSchema),
}).strict()

const applyProjectionEvent = (state: LoopProjection, event: SessionEvent): LoopProjection => (
  event.type === 'loop/change' ? applyLoopChange(state, event.data) : state
)

export const loopProjectionDefinition: LoopProjectionDefinition = {
  key: 'claude-code-loop',
  schema: loopProjectionSchema,
  stateVersion: 1,
  init: () => ({ loops: [] }),
  apply: applyProjectionEvent,
  view: state => state,
}

export function applyLoopProjection(state: LoopProjection, event: SessionEvent): LoopProjection {
  return event.type === 'loop/change' ? applyLoopChange(state, event.data) : state
}

function applyLoopChange(state: LoopProjection, change: LoopChange): LoopProjection {
  switch (change.operation) {
    case 'create':
      return { loops: [...state.loops.filter(loop => loop.id !== change.loop.id), change.loop] }
    case 'update':
      return { loops: state.loops.map(loop => loop.id === change.loop.id ? change.loop : loop) }
    case 'delete':
      return { loops: state.loops.filter(loop => loop.id !== change.id) }
    case 'dispatch':
      return { loops: state.loops.map(loop => loop.id === change.id ? { ...loop, next_at: change.next_at } : loop) }
  }
}
