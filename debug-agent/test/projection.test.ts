import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import '../src/types.js'
import { debugStatusProjectionDefinition } from '../src/projection.js'
import type { DebugUiState } from '../src/types.js'

function state(runId: string, phase: DebugUiState['phase'], currentStep = 0): DebugUiState {
  return {
    sessionId: 'projection-session',
    runId,
    mode: 'replay',
    phase,
    currentStep,
    totalSteps: 3,
  }
}

describe('debug status projection', () => {
  it('keeps a newer run from being overwritten by a late older-run event', () => {
    const session = Session.create(SessionId('projection-session'))
    const oldQueued = session.append('debug/status', state('run-old', 'queued'))
    const newRunning = session.append('debug/status', state('run-new', 'running', 1))
    const oldCompleted = session.append('debug/status', state('run-old', 'completed', 3))

    let folded = debugStatusProjectionDefinition.init()
    for (const event of [oldQueued, newRunning, oldCompleted]) {
      folded = debugStatusProjectionDefinition.apply(folded, event)
    }

    expect(debugStatusProjectionDefinition.view(folded)).toMatchObject({
      runId: 'run-new',
      phase: 'running',
      currentStep: 1,
    })
  })

  it('accepts later states from the same run', () => {
    const session = Session.create(SessionId('projection-session-same-run'))
    const queued = session.append('debug/status', state('run-same', 'queued'))
    const waiting = session.append('debug/status', state('run-same', 'waiting', 2))

    let folded = debugStatusProjectionDefinition.init()
    folded = debugStatusProjectionDefinition.apply(folded, queued)
    folded = debugStatusProjectionDefinition.apply(folded, waiting)

    expect(debugStatusProjectionDefinition.view(folded)).toMatchObject({
      runId: 'run-same',
      phase: 'waiting',
      currentStep: 2,
    })
  })
})
