import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { applyLoopProjection, loopProjectionDefinition } from '../src/projection.js'
import { createLoopRecord } from '../src/loop.js'
import type { LoopProjection } from '../src/types.js'

function event(data: unknown, seq = 0): SessionEvent {
  return { type: 'loop/change', seq, time: 0, data } as never
}

describe('loop session projection', () => {
  it('projects create, update, dispatch, delete, and ignores other events', () => {
    const record = createLoopRecord('check', 5, 0, 'loop_1')
    const updated = { ...record, next_at: 10_000 }
    let state: LoopProjection = loopProjectionDefinition.init()
    state = applyLoopProjection(state, { type: 'message', seq: 0, time: 0, data: {} } as never)
    state = applyLoopProjection(state, event({ version: 1, operation: 'update', loop: updated }))
    state = applyLoopProjection(state, event({ version: 1, operation: 'create', loop: record }))
    state = applyLoopProjection(state, event({ version: 1, operation: 'update', loop: { ...record, id: 'other' } }, 1))
    state = applyLoopProjection(state, event({ version: 1, operation: 'update', loop: updated }, 2))
    state = applyLoopProjection(state, event({ version: 1, operation: 'dispatch', id: 'loop_1', next_at: 20_000 }, 3))
    expect(state.loops).toEqual([{ ...updated, next_at: 20_000 }])
    state = applyLoopProjection(state, event({ version: 1, operation: 'delete', id: 'loop_1' }, 4))
    expect(state).toEqual({ loops: [] })
  })

  it('validates the wire view and keeps the definition identity stable', () => {
    expect(loopProjectionDefinition.key).toBe('loop')
    expect(loopProjectionDefinition.stateVersion).toBe(1)
    expect(loopProjectionDefinition.view({ loops: [] })).toEqual({ loops: [] })
    expect(loopProjectionDefinition.schema.parse({ loops: [] })).toEqual({ loops: [] })
    expect(() => loopProjectionDefinition.schema.parse({ loops: [{ id: 'loop_1' }] })).toThrow()
  })

  it('hides legacy title and delivery fields from the current projection', () => {
    const legacy = {
      id: 'loop_legacy',
      title: 'Old title',
      prompt: 'check',
      time_in_seconds: 5,
      allow_steer: true,
      next_at: 5_000,
    }
    expect(loopProjectionDefinition.schema.parse({ loops: [legacy] })).toEqual({
      loops: [{ id: 'loop_legacy', prompt: 'check', time_in_seconds: 5, next_at: 5_000 }],
    })
  })
})
