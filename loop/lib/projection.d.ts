import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { LoopProjection } from './types.js';
interface LoopProjectionDefinition {
    readonly key: 'loop';
    readonly schema: {
        parse(value: unknown): LoopProjection;
    };
    readonly stateVersion: number;
    readonly init: () => LoopProjection;
    readonly apply: (state: LoopProjection, event: SessionEvent) => LoopProjection;
    readonly view: (state: LoopProjection) => LoopProjection;
}
export declare const loopProjectionDefinition: LoopProjectionDefinition;
export declare function applyLoopProjection(state: LoopProjection, event: SessionEvent): LoopProjection;
export {};
//# sourceMappingURL=projection.d.ts.map