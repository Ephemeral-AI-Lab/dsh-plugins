import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type MockAgentKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Compact mock replay/run status copy. */
        mockAgent: MockAgentKey;
    }
}
/** Services required by the session-scoped composer status entry. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map