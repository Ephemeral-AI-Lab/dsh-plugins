import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyLoopChange as applyValidatedLoopChange } from './loop.js'
import type { LoopProjection } from './types.js'
import type {} from '@deepseek-ai/dsh-session/types'

interface LoopProjectionDefinition {
  readonly key: 'loop'
  readonly schema: { parse(value: unknown): LoopProjection }
  readonly stateVersion: number
  readonly init: () => LoopProjection
  readonly apply: (state: LoopProjection, event: SessionEvent) => LoopProjection
  readonly view: (state: LoopProjection) => LoopProjection
}

const loopRecordSchema = z.object({
  id: z.string().min(1).refine(value => value.trim() === value),
  prompt: z.string().refine(value => value.trim().length > 0),
  time_in_seconds: z.number().int().positive().refine(Number.isSafeInteger),
  next_at: z.number().int().nonnegative().refine(Number.isSafeInteger),
  // Accept records written by the previous plugin build, then hide its
  // removed fields from the current projection.
  title: z.string().optional(),
  allow_steer: z.boolean().optional(),
}).strict().transform(({ title: _title, allow_steer: _allowSteer, ...record }) => record)

const loopProjectionSchema = z.object({
  loops: z.array(loopRecordSchema),
}).strict()

const applyProjectionEvent = (state: LoopProjection, event: SessionEvent): LoopProjection => (
  event.type === 'loop/change' ? applyLoopChange(state, event.data) : state
)

export const loopProjectionDefinition: LoopProjectionDefinition = {
  key: 'loop',
  schema: loopProjectionSchema,
  stateVersion: 1,
  init: () => ({ loops: [] }),
  apply: applyProjectionEvent,
  view: state => state,
}

export function applyLoopProjection(state: LoopProjection, event: SessionEvent): LoopProjection {
  return event.type === 'loop/change' ? applyLoopChange(state, event.data) : state
}

function applyLoopChange(state: LoopProjection, change: unknown): LoopProjection {
  return { loops: [...applyValidatedLoopChange(state.loops, change)] }
}
