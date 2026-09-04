import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { SideChatAnchorSummary, SideChatId, SideChatSnapshot } from '../types.js';
export interface SideChatTab {
    id: SideChatId;
    capability: string;
    title: string;
    anchor: SideChatAnchorSummary;
    remote: SideChatSnapshot;
    loading: boolean;
    error: string | undefined;
}
export interface SideChatStoreSnapshot {
    tabs: readonly SideChatTab[];
    activeId: SideChatId | null;
    opening: boolean;
}
export declare class SideChatClient {
    private readonly rpc;
    constructor(rpc: ClientConnectionRpc);
    call<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T>;
}
export declare class SideChatStore {
    private readonly client;
    private readonly listeners;
    private snapshot;
    constructor(client: SideChatClient);
    getSnapshot: () => SideChatStoreSnapshot;
    subscribe: (listener: () => void) => (() => void);
    create(anchorSessionId: string, title: string): Promise<void>;
    select(id: SideChatId): void;
    submit(id: SideChatId, text: string, delivery: 'followup' | 'steer'): Promise<void>;
    pull(id: SideChatId): Promise<void>;
    refreshAnchor(id: SideChatId): Promise<void>;
    stop(id: SideChatId): Promise<void>;
    close(id: SideChatId): Promise<void>;
    dispose(): Promise<void>;
    private find;
    private patch;
    private publish;
}
//# sourceMappingURL=store.d.ts.map