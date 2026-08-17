import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { LoopChange, LoopProjection, LoopRecord } from './types.js'
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
  id: z.string(),
  prompt: z.string(),
  time_in_seconds: z.number().int().positive(),
  next_at: z.number().int().nonnegative(),
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

function applyLoopChange(state: LoopProjection, change: LoopChange): LoopProjection {
  switch (change.operation) {
    case 'create':
      return { loops: [...state.loops.filter(loop => loop.id !== change.loop.id), normalizeRecord(change.loop)] }
    case 'update':
      return { loops: state.loops.map(loop => loop.id === change.loop.id ? normalizeRecord(change.loop) : loop) }
    case 'delete':
      return { loops: state.loops.filter(loop => loop.id !== change.id) }
    case 'dispatch':
      return { loops: state.loops.map(loop => loop.id === change.id ? { ...loop, next_at: change.next_at } : loop) }
  }
}

function normalizeRecord(record: LoopRecord): LoopRecord {
  const legacy = record as typeof record & { readonly title?: unknown; readonly allow_steer?: unknown }
  const { title: _title, allow_steer: _allowSteer, ...current } = legacy
  return current
}
