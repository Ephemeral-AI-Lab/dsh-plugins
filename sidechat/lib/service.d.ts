import { type GenerateOptions } from '@deepseek-ai/dsh-llm';
import { SessionId, type Session } from '@deepseek-ai/dsh-session';
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence';
import type { SideChatAddress, SideChatAnchorSummary, SideChatCloseValue, SideChatInputBlock, SideChatOpenValue, SideChatResult, SideChatSnapshot, SideChatStopValue, SideChatSubmitValue } from './types.js';
export declare const SIDECHAT_SYSTEM_PROMPT = "You are a temporary side chat attached to a DeepSeek Harness conversation.\n\nThe preceding centered conversation is immutable reference context. You may read, explain, compare, summarize, and reason about it. You cannot modify that conversation, edit files, invoke tools, create or control agents, send messages to agents, or change runtime state.\n\nNo tools or agent communication channels are available. If the user requests a state-changing action, explain what should be done in the centered conversation instead of claiming that you performed it.";
interface LiveSessionStore {
    get(id: SessionId): Session | undefined;
}
interface PersistenceReader {
    inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>;
}
interface AgentReader {
    get(id: SessionId): {
        options: {
            provider?: string;
            model?: string;
        };
    } | undefined;
}
export interface SideChatDependencies {
    llm: {
        stream(options: GenerateOptions): AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>;
    };
    sessions: LiveSessionStore;
    sessionPersistence: PersistenceReader;
    agents: AgentReader;
    agentDefaultModel: {
        currentSelection(): {
            provider: string;
            model: string;
            reasoningEffort?: string;
        };
    };
}
export interface SideChatRuntimeOptions {
    now?: () => number;
    mintId?: () => string;
    mintCapability?: () => string;
    startSweep?: boolean;
}
export declare class SideChatRuntime {
    private readonly deps;
    private readonly states;
    private readonly now;
    private readonly mintId;
    private readonly mintCapability;
    private readonly sweep;
    constructor(deps: SideChatDependencies, options?: SideChatRuntimeOptions);
    handle(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<SideChatResult<unknown>>;
    open(anchorSessionId: string, title?: string, signal?: AbortSignal): Promise<SideChatOpenValue>;
    submit(args: SideChatAddress & {
        content: SideChatInputBlock[];
        delivery: 'followup' | 'steer';
    }): SideChatSubmitValue;
    snapshot(address: SideChatAddress): SideChatSnapshot;
    refresh(address: SideChatAddress, signal?: AbortSignal): Promise<SideChatAnchorSummary>;
    stop(address: SideChatAddress): SideChatStopValue;
    close(address: SideChatAddress): SideChatCloseValue;
    collectExpired(now?: number): number;
    dispose(): void;
    private captureAnchor;
    private liveRoute;
    private requireState;
    private start;
    private generate;
    private recordInterrupted;
    private view;
    private destroy;
}
export {};
//# sourceMappingURL=service.d.ts.map