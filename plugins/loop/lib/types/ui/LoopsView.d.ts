import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export interface LoopsViewInjected {
    execute: (line: string) => Promise<unknown>;
}
type LoopsViewProps = PropsRuntime<'conversation.input.dock'> & LoopsViewInjected;
export declare function LoopsView({ useProjection, execute }: LoopsViewProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=LoopsView.d.ts.map