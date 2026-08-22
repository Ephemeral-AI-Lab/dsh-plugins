import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { WorkbenchPanelProps } from 'dsh-workbench-ui/client';
import type { SideChatId } from '../types.js';
import type { SideChatStore } from './store.js';
export interface SideChatPanelProps extends WorkbenchPanelProps {
    store: SideChatStore;
    sessions: ISessions;
}
export declare function SideChatPanel({ store, sessions, close: _close }: SideChatPanelProps): import("react").JSX.Element;
export type { SideChatId, SessionId };
//# sourceMappingURL=SideChatPanel.d.ts.map