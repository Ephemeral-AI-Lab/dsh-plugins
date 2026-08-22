import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import z from 'zod';
import { BlockAssembler, createAssistantMessage, createMessage, createUserMessage, ReasoningEffortId, } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { requestRoute, sideChatKind, stableMessages } from './context.js';
const IDLE_TTL_MS = 30 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
export const SIDECHAT_SYSTEM_PROMPT = `You are a temporary side chat attached to a DeepSeek Harness conversation.

The preceding centered conversation is immutable reference context. You may read, explain, compare, summarize, and reason about it. You cannot modify that conversation, edit files, invoke tools, create or control agents, send messages to agents, or change runtime state.

No tools or agent communication channels are available. If the user requests a state-changing action, explain what should be done in the centered conversation instead of claiming that you performed it.`;
class SideChatFault extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SideChatFault';
    }
}
const openSchema = z.object({
    anchorSessionId: z.string().trim().min(1).max(512),
    anchorTitle: z.string().trim().min(1).max(512).optional(),
}).strict();
const addressSchema = z.object({
    sideChatId: z.string().uuid(),
    capability: z.string().min(32).max(256),
}).strict();
const inputBlockSchema = z.object({
    type: z.literal('text'),
    text: z.string().trim().min(1).max(100_000),
}).strict();
const submitSchema = addressSchema.extend({
    content: z.array(inputBlockSchema).min(1).max(16),
    delivery: z.union([z.literal('followup'), z.literal('steer')]),
}).strict();
const addressOnlySchema = addressSchema.strict();
function visibleBlocks(blocks) {
    return blocks.flatMap((block) => block.type === 'text' || block.type === 'reasoning'
        ? [{ type: block.type, text: block.text }]
        : []);
}
function hasText(blocks) {
    return blocks.some(block => block.text.trim().length > 0);
}
function safeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}
function boundaryMessage(anchor) {
    const title = anchor.title ?? anchor.sessionId;
    return createMessage({
        role: 'user',
        content: [{
                type: 'text',
                text: `The conversation above is read-only context captured from "${title}" through event ${String(anchor.capturedThroughSeq)}. The temporary side chat begins after this message.`,
            }],
        source: { kind: 'plugin', plugin: 'dsh-sidechat', form: 'recall' },
    });
}
function appError(code, message) {
    return { ok: false, error: { code, message } };
}
export class SideChatRuntime {
    deps;
    states = new Map();
    now;
    mintId;
    mintCapability;
    sweep;
    constructor(deps, options = {}) {
        this.deps = deps;
        this.now = options.now ?? Date.now;
        this.mintId = options.mintId ?? randomUUID;
        this.mintCapability = options.mintCapability ?? (() => randomBytes(32).toString('base64url'));
        if (options.startSweep === false)
            return;
        this.sweep = setInterval(() => { this.collectExpired(); }, SWEEP_MS);
        this.sweep.unref?.();
    }
    async handle(endpoint, payload, signal) {
        try {
            switch (endpoint) {
                case 'open': {
                    const args = openSchema.parse(payload);
                    return { ok: true, value: await this.open(args.anchorSessionId, args.anchorTitle, signal) };
                }
                case 'submit': {
                    const args = submitSchema.parse(payload);
                    return { ok: true, value: this.submit(args) };
                }
                case 'snapshot': {
                    const args = addressOnlySchema.parse(payload);
                    return { ok: true, value: this.snapshot(args) };
                }
                case 'refresh': {
                    const args = addressOnlySchema.parse(payload);
                    return { ok: true, value: await this.refresh(args, signal) };
                }
                case 'stop': {
                    const args = addressOnlySchema.parse(payload);
                    return { ok: true, value: this.stop(args) };
                }
                case 'close': {
                    const args = addressOnlySchema.parse(payload);
                    return { ok: true, value: this.close(args) };
                }
                default:
                    return appError('bad-request', `unknown sidechat endpoint "${endpoint}"`);
            }
        }
        catch (error) {
            if (error instanceof SideChatFault)
                return appError(error.code, error.message);
            if (error instanceof z.ZodError)
                return appError('bad-request', error.issues[0]?.message ?? 'invalid request');
            return appError('internal', error instanceof Error ? error.message : String(error));
        }
    }
    async open(anchorSessionId, title, signal) {
        signal?.throwIfAborted();
        const anchor = await this.captureAnchor(SessionId(anchorSessionId), title, signal);
        const id = this.mintId();
        const capability = this.mintCapability();
        const now = this.now();
        this.states.set(id, {
            id,
            capability,
            anchor,
            messages: [],
            pending: [],
            createdAt: now,
            lastAccessedAt: now,
            closed: false,
        });
        return { sideChatId: id, capability, anchor: anchor.summary };
    }
    submit(args) {
        const state = this.requireState(args);
        const input = {
            id: this.mintId(),
            delivery: args.delivery,
            content: structuredClone(args.content),
        };
        state.lastAccessedAt = this.now();
        if (state.active === undefined) {
            this.start(state, input);
        }
        else if (input.delivery === 'followup') {
            state.pending.push(input);
        }
        else {
            state.pending = [input, ...state.pending.filter(candidate => candidate.delivery !== 'steer')];
            state.active.controller.abort('steer');
        }
        return { messageId: input.id, accepted: true };
    }
    snapshot(address) {
        const state = this.requireState(address);
        state.lastAccessedAt = this.now();
        return this.view(state);
    }
    async refresh(address, signal) {
        const state = this.requireState(address);
        const next = await this.captureAnchor(SessionId(state.anchor.summary.sessionId), state.anchor.summary.title, signal);
        state.anchor = next;
        state.lastAccessedAt = this.now();
        return next.summary;
    }
    stop(address) {
        const state = this.requireState(address);
        state.lastAccessedAt = this.now();
        state.pending = [];
        state.active?.controller.abort('stop');
        return { accepted: true };
    }
    close(address) {
        const state = this.requireState(address);
        this.destroy(state);
        return { closed: true };
    }
    collectExpired(now = this.now()) {
        let removed = 0;
        for (const state of this.states.values()) {
            if (state.active !== undefined || now - state.lastAccessedAt < IDLE_TTL_MS)
                continue;
            this.destroy(state);
            removed += 1;
        }
        return removed;
    }
    dispose() {
        if (this.sweep !== undefined)
            clearInterval(this.sweep);
        for (const state of [...this.states.values()])
            this.destroy(state);
    }
    async captureAnchor(id, title, signal) {
        signal?.throwIfAborted();
        const live = this.deps.sessions.get(id);
        let header;
        let events;
        if (live !== undefined) {
            header = live.header;
            events = live.events;
        }
        else {
            let inspected;
            try {
                inspected = await this.deps.sessionPersistence.inspect(id, signal);
            }
            catch (error) {
                signal?.throwIfAborted();
                throw new SideChatFault('anchor-not-found', `centered conversation "${id}" is unavailable`);
            }
            header = inspected.meta;
            events = inspected.events;
        }
        signal?.throwIfAborted();
        const stable = stableMessages(events);
        const route = requestRoute(events)
            ?? this.liveRoute(id)
            ?? this.deps.agentDefaultModel.currentSelection();
        if (route.provider.length === 0 || route.model.length === 0) {
            throw new SideChatFault('model-unavailable', 'no model route is available for sidechat');
        }
        const capturedAt = this.now();
        const summary = {
            sessionId: String(id),
            kind: sideChatKind(header),
            ...title === undefined ? {} : { title },
            ...header.cwd === undefined ? {} : { cwd: header.cwd },
            ...header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset },
            capturedAt,
            capturedThroughSeq: stable.throughSeq,
            inheritedMessages: stable.messages.length,
            provider: route.provider,
            model: route.model,
        };
        return {
            summary,
            messages: stable.messages,
            route: {
                provider: route.provider,
                model: route.model,
                ...route.reasoningEffort === undefined ? {} : { reasoningEffort: String(route.reasoningEffort) },
            },
        };
    }
    liveRoute(id) {
        const options = this.deps.agents.get(id)?.options;
        if (options?.provider === undefined || options.model === undefined)
            return undefined;
        return { provider: options.provider, model: options.model };
    }
    requireState(address) {
        const state = this.states.get(address.sideChatId);
        if (state === undefined || state.closed || !safeEqual(state.capability, address.capability)) {
            throw new SideChatFault('sidechat-not-found', 'sidechat was closed, expired, or is unavailable');
        }
        return state;
    }
    start(state, input) {
        if (state.closed || this.states.get(state.id) !== state)
            return;
        delete state.error;
        const content = input.content.map(block => ({ type: 'text', text: block.text }));
        const user = createUserMessage({ content, source: { kind: 'user' } });
        state.messages.push({
            view: { id: String(user.id), role: 'user', content: input.content },
            model: user,
        });
        const active = {
            inputId: input.id,
            controller: new AbortController(),
            partial: [],
        };
        state.active = active;
        state.lastAccessedAt = this.now();
        void this.generate(state, active);
    }
    async generate(state, active) {
        const assembler = new BlockAssembler();
        const route = state.anchor.route;
        try {
            const options = {
                provider: route.provider,
                model: route.model,
                ...route.reasoningEffort === undefined
                    ? {}
                    : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
                system: SIDECHAT_SYSTEM_PROMPT,
                messages: [
                    ...state.anchor.messages,
                    boundaryMessage(state.anchor.summary),
                    ...state.messages.flatMap(entry => entry.model === undefined ? [] : [entry.model]),
                ],
                signal: active.controller.signal,
            };
            for await (const chunk of this.deps.llm.stream(options)) {
                assembler.push(chunk);
                active.partial = visibleBlocks(assembler.interruptedBlocks());
            }
            if (active.controller.signal.aborted) {
                this.recordInterrupted(state, active);
            }
            else if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
                state.error = assembler.finish.failure.message;
            }
            else {
                const blocks = visibleBlocks(assembler.blocks());
                if (!hasText(blocks)) {
                    state.error = 'sidechat model produced no displayable answer';
                }
                else {
                    const assistant = createAssistantMessage({
                        content: blocks,
                        source: { provider: route.provider, model: route.model },
                    });
                    state.messages.push({
                        view: { id: String(assistant.id), role: 'assistant', content: blocks },
                        model: assistant,
                    });
                }
            }
        }
        catch (error) {
            if (active.controller.signal.aborted)
                this.recordInterrupted(state, active);
            else
                state.error = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (state.active === active)
                delete state.active;
            if (!state.closed && this.states.get(state.id) === state) {
                state.lastAccessedAt = this.now();
                const next = state.pending.shift();
                if (next !== undefined)
                    this.start(state, next);
            }
        }
    }
    recordInterrupted(state, active) {
        if (!hasText(active.partial))
            return;
        state.messages.push({
            view: {
                id: this.mintId(),
                role: 'assistant',
                content: structuredClone(active.partial),
                interrupted: true,
            },
        });
    }
    view(state) {
        return {
            status: state.active !== undefined ? 'running' : state.error === undefined ? 'idle' : 'error',
            messages: structuredClone(state.messages.map(entry => entry.view)),
            ...state.active === undefined || !hasText(state.active.partial)
                ? {}
                : { partialAssistant: structuredClone(state.active.partial) },
            queuedCount: state.pending.length,
            anchor: structuredClone(state.anchor.summary),
            ...state.error === undefined ? {} : { error: state.error },
        };
    }
    destroy(state) {
        if (state.closed)
            return;
        state.closed = true;
        state.active?.controller.abort('sidechat closed');
        state.pending = [];
        state.messages = [];
        state.anchor.messages = [];
        this.states.delete(state.id);
    }
}
//# sourceMappingURL=service.js.map