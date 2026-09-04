import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MockUiState } from '../types.js';
import type { MockAgentKey } from './locales.js';
export type MockStatusRowProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'mockAgent'>;
interface StatusProps {
    readonly state: MockUiState | null | undefined;
    readonly t: (key: MockAgentKey, params?: Record<string, string | number>) => string;
}
export declare function statusTextFor(state: MockUiState, t: StatusProps['t']): string;
export declare function MockStatusRow({ state, t }: StatusProps): import("react").JSX.Element | null;
export declare function MockStatusDock({ useProjection, t }: MockStatusRowProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=MockStatusRow.d.ts.map