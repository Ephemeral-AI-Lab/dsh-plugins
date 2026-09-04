import { type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session';
import type { Message } from '@deepseek-ai/dsh-llm';
export interface StableMessages {
    messages: Message[];
    throughSeq: number;
}
/** Reconstruct the exact message surface through the latest completed step. */
export declare function stableMessages(events: readonly SessionEvent[]): StableMessages;
export declare function sideChatKind(header: SessionHeader): 'main' | 'fork' | 'subagent';
export declare function requestRoute(events: readonly SessionEvent[]): {
    provider: string;
    model: string;
    reasoningEffort?: string;
} | undefined;
//# sourceMappingURL=context.d.ts.map