/** Shared debug state contract used by the host adapter and browser surface. */

export type DebugRunMode = 'run' | 'replay'

export type DebugRunPhase = 'queued' | 'running' | 'waiting' | 'failed' | 'completed' | 'cancelled'

export interface DebugUiState {
  readonly sessionId: string
  readonly runId: string
  readonly mode: DebugRunMode
  readonly phase: DebugRunPhase
  readonly currentStep: number
  readonly totalSteps: number
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly sourcePath?: string
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Log-only, plugin-owned progress state for the debug composer surface. */
    'debug/status': DebugUiState
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The latest debug run state, or null before a run has started. */
    debugStatus: DebugUiState | null
  }
}
