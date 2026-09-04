import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { MockUiState } from './types.js';
interface MockStatusProjectionState {
    readonly value: MockUiState | null;
    readonly runId: string | null;
    readonly seenRunIds: readonly string[];
}
/** Fold the latest log-only mock status into the client projection stream. */
export declare const mockStatusProjectionDefinition: ProjectionDefinition<'mockStatus', MockStatusProjectionState>;
export {};
//# sourceMappingURL=projection.d.ts.map