import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import '../src/types.js'
import { mockStatusProjectionDefinition } from '../src/projection.js'
import type { MockUiState } from '../src/types.js'

function state(runId: string, phase: MockUiState['phase'], currentStep = 0): MockUiState {
  return {
    sessionId: 'projection-session',
    runId,
    mode: 'replay',
    phase,
    currentStep,
    totalSteps: 3,
  }
}

describe('mock status projection', () => {
  it('keeps a newer run from being overwritten by a late older-run event', () => {
    const session = Session.create(SessionId('projection-session'))
    const oldQueued = session.append('mock/status', state('run-old', 'queued'))
    const newRunning = session.append('mock/status', state('run-new', 'running', 1))
    const oldCompleted = session.append('mock/status', state('run-old', 'completed', 3))

    let folded = mockStatusProjectionDefinition.init()
    for (const event of [oldQueued, newRunning, oldCompleted]) {
      folded = mockStatusProjectionDefinition.apply(folded, event)
    }

    expect(mockStatusProjectionDefinition.view(folded)).toMatchObject({
      runId: 'run-new',
      phase: 'running',
      currentStep: 1,
    })
  })

  it('accepts later states from the same run', () => {
    const session = Session.create(SessionId('projection-session-same-run'))
    const queued = session.append('mock/status', state('run-same', 'queued'))
    const waiting = session.append('mock/status', state('run-same', 'waiting', 2))

    let folded = mockStatusProjectionDefinition.init()
    folded = mockStatusProjectionDefinition.apply(folded, queued)
    folded = mockStatusProjectionDefinition.apply(folded, waiting)

    expect(mockStatusProjectionDefinition.view(folded)).toMatchObject({
      runId: 'run-same',
      phase: 'waiting',
      currentStep: 2,
    })
  })
})
