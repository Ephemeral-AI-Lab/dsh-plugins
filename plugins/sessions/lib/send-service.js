import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId as makeSessionId } from '@deepseek-ai/dsh-session';
/** Sends messages to existing sessions and owns handles resumed for delivery. */
export class SessionSendService {
    ctx;
    ownedHandles = new Map();
    persistence;
    constructor(ctx) {
        this.ctx = ctx;
        this.persistence = ctx.sessionPersistence;
    }
    async send(args, parent, signal) {
        const sessionId = toSessionId(args.session_id);
        requireText(args.message, 'message');
        const mode = validateMode(args.mode);
        signal?.throwIfAborted();
        let agent = this.ctx.agents.get(sessionId);
        let resumed;
        if (agent === undefined) {
            const owner = parent?.ctx ?? this.ctx;
            const inspection = await this.persistence.inspect(sessionId, signal);
            const storedPreset = resolveStoredPreset(inspection.meta, inspection.events);
            const setup = await resumeComposition(owner, parent, storedPreset);
            resumed = await owner.agents.resume({
                resumeSessionId: sessionId,
                ...parent === undefined ? {} : { agentOptions: parent.options },
                ...setup === undefined ? {} : { setup },
            });
            this.ownedHandles.set(sessionId, resumed);
            agent = resumed.agent;
        }
        const message = createUserMessage({
            content: [{ type: 'text', text: args.message }],
            source: { kind: 'user' },
        });
        try {
            signal?.throwIfAborted();
            if (mode === 'steer')
                agent.steer(message);
            else
                agent.followup(message);
        }
        catch (error) {
            if (resumed !== undefined) {
                this.ownedHandles.delete(sessionId);
                await resumed.dispose();
            }
            throw error;
        }
        return { message_id: String(message.id) };
    }
    async dispose() {
        const handles = [...this.ownedHandles.values()];
        this.ownedHandles.clear();
        await Promise.all(handles.map(handle => handle.dispose()));
    }
}
async function resumeComposition(owner, parent, storedPreset) {
    const ownerPresets = owner.get('agentPresets');
    if (parent !== undefined) {
        const parentPresets = parent.ctx.get('agentPresets');
        if (parentPresets !== undefined
            && parentPresets.composedPreset?.(parent.ctx) === storedPreset
            && storedPreset !== undefined) {
            return async (childCtx) => { parentPresets.composeFrom(childCtx, parent.ctx); };
        }
    }
    if (ownerPresets === undefined)
        return undefined;
    const resolved = await ownerPresets.resolve(storedPreset);
    return async (childCtx) => { await ownerPresets.mount(childCtx, resolved.id); };
}
function resolveStoredPreset(header, events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (!isRecord(event) || event.type !== 'agent-preset/selected' || !isRecord(event.data))
            continue;
        if (typeof event.data.agentPreset === 'string')
            return event.data.agentPreset;
    }
    return isRecord(header) && typeof header.agentPreset === 'string' ? header.agentPreset : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireText(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
}
function toSessionId(value) {
    requireText(value, 'session_id');
    return makeSessionId(value.trim());
}
function validateMode(mode) {
    if (mode === undefined)
        return 'steer';
    if (mode !== 'steer' && mode !== 'followup') {
        throw new Error('mode must be either steer or followup');
    }
    return mode;
}
//# sourceMappingURL=send-service.js.map