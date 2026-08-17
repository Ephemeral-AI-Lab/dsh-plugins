import type {} from '@deepseek-ai/dsh-session/types'

export const LOOP_CHANGE_VERSION = 1 as const

export interface LoopRecord {
  readonly id: string
  readonly prompt: string
  readonly time_in_seconds: number
  readonly next_at: number
}

export interface LoopCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly loop: LoopRecord
}

export interface LoopDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: string
}

export interface LoopUpdateChange {
  readonly version: 1
  readonly operation: 'update'
  readonly loop: LoopRecord
}

export interface LoopDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: string
  readonly next_at: number
}

export type LoopChange = LoopCreateChange | LoopDeleteChange | LoopUpdateChange | LoopDispatchChange

export interface LoopProjection {
  readonly loops: readonly LoopRecord[]
}

export interface LoopView extends LoopRecord {
  readonly state: 'scheduled' | 'overdue'
  readonly delivery_mode: 'session-local'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'loop/change': LoopChange
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'loop': LoopProjection
  }
}
