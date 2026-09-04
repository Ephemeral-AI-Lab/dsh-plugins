import { z } from 'zod';
import { applyLoopChange as applyValidatedLoopChange } from './loop.js';
const loopRecordSchema = z.object({
    id: z.string().min(1).refine(value => value.trim() === value),
    prompt: z.string().refine(value => value.trim().length > 0),
    time_in_seconds: z.number().int().positive().refine(Number.isSafeInteger),
    next_at: z.number().int().nonnegative().refine(Number.isSafeInteger),
    // Accept records written by the previous plugin build, then hide its
    // removed fields from the current projection.
    title: z.string().optional(),
    allow_steer: z.boolean().optional(),
}).strict().transform(({ title: _title, allow_steer: _allowSteer, ...record }) => record);
const loopProjectionSchema = z.object({
    loops: z.array(loopRecordSchema),
}).strict();
const applyProjectionEvent = (state, event) => (event.type === 'loop/change' ? applyLoopChange(state, event.data) : state);
export const loopProjectionDefinition = {
    key: 'loop',
    schema: loopProjectionSchema,
    stateVersion: 1,
    init: () => ({ loops: [] }),
    apply: applyProjectionEvent,
    view: state => state,
};
export function applyLoopProjection(state, event) {
    return event.type === 'loop/change' ? applyLoopChange(state, event.data) : state;
}
function applyLoopChange(state, change) {
    return { loops: [...applyValidatedLoopChange(state.loops, change)] };
}
//# sourceMappingURL=projection.js.map