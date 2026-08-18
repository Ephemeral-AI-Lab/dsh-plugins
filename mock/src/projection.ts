import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { MockUiState } from './types.js'

const mockStateSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  mode: z.union([z.literal('run'), z.literal('replay')]),
  phase: z.union([
    z.literal('queued'),
    z.literal('running'),
    z.literal('waiting'),
    z.literal('failed'),
    z.literal('completed'),
    z.literal('cancelled'),
  ]),
  currentStep: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  sourcePath: z.string().optional(),
}).strict()

const projectionSchema = z.union([mockStateSchema, z.null()])

interface MockStatusProjectionState {
  readonly value: MockUiState | null
  readonly runId: string | null
  readonly seenRunIds: readonly string[]
}

/** Fold the latest log-only mock status into the client projection stream. */
export const mockStatusProjectionDefinition:
ProjectionDefinition<'mockStatus', MockStatusProjectionState> = {
  key: 'mockStatus',
  schema: projectionSchema as unknown as ProjectionDefinition<'mockStatus', MockUiState | null>['schema'],
  init: () => ({ value: null, runId: null, seenRunIds: [] }),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'mock/status') return state
    // A session can receive a late event from a superseded run. A runId that
    // has already appeared in the log but is no longer current is old; a
    // never-seen runId is a new run and becomes the owner of the projection.
    if (state.runId !== null
      && state.runId !== event.data.runId
      && state.seenRunIds.includes(event.data.runId)) return state
    return {
      value: event.data,
      runId: event.data.runId,
      seenRunIds: state.seenRunIds.includes(event.data.runId)
        ? state.seenRunIds
        : [...state.seenRunIds, event.data.runId],
    }
  },
  view: state => state.value,
  stateVersion: 2,
}
