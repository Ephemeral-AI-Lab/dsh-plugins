/** Shared mock state contract used by the host adapter and browser surface. */

export type MockRunMode = 'run' | 'replay'

export type MockRunPhase = 'queued' | 'running' | 'waiting' | 'failed' | 'completed' | 'cancelled'

export interface MockUiState {
  readonly sessionId: string
  readonly runId: string
  readonly mode: MockRunMode
  readonly phase: MockRunPhase
  readonly currentStep: number
  readonly totalSteps: number
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly sourcePath?: string
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Log-only, plugin-owned progress state for the mock composer surface. */
    'mock/status': MockUiState
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The latest mock run state, or null before a run has started. */
    mockStatus: MockUiState | null
  }
}
