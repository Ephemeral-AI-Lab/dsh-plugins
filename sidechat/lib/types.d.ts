export type SideChatId = string & {
    readonly __sideChatId: unique symbol;
};
export interface SideChatAddress {
    sideChatId: SideChatId;
    capability: string;
}
export type SideChatErrorCode = 'bad-request' | 'anchor-not-found' | 'anchor-unavailable' | 'model-unavailable' | 'sidechat-not-found' | 'generation-failed' | 'internal';
export interface SideChatError {
    code: SideChatErrorCode;
    message: string;
}
export type SideChatResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: SideChatError;
};
export interface SideChatInputBlock {
    type: 'text';
    text: string;
}
export type SideChatOutputBlock = {
    type: 'text';
    text: string;
} | {
    type: 'reasoning';
    text: string;
};
export interface SideChatMessageView {
    id: string;
    role: 'user' | 'assistant';
    content: SideChatOutputBlock[];
    interrupted?: true;
}
export interface SideChatAnchorSummary {
    sessionId: string;
    kind: 'main' | 'fork' | 'subagent';
    title?: string;
    cwd?: string;
    agentPreset?: string;
    capturedAt: number;
    capturedThroughSeq: number;
    inheritedMessages: number;
    provider: string;
    model: string;
}
export interface SideChatSnapshot {
    status: 'idle' | 'running' | 'error';
    messages: SideChatMessageView[];
    partialAssistant?: SideChatOutputBlock[];
    queuedCount: number;
    anchor: SideChatAnchorSummary;
    error?: string;
}
export interface SideChatOpenValue extends SideChatAddress {
    anchor: SideChatAnchorSummary;
}
export interface SideChatSubmitValue {
    messageId: string;
    accepted: true;
}
export interface SideChatStopValue {
    accepted: true;
}
export interface SideChatCloseValue {
    closed: true;
}
//# sourceMappingURL=types.d.ts.map