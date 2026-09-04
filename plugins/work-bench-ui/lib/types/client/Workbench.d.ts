import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorkbenchService } from './registry.js';
type SessionExport = {
    download: (sessionId: SessionId) => Promise<void>;
};
export type WorkbenchHeaderActionProps = PropsRuntime<'conversation.session.header.utilities'> & {
    workbench: WorkbenchService;
};
export type ExportHeaderActionProps = PropsRuntime<'conversation.session.header.utilities'> & {
    sessionExport: SessionExport;
};
export type WorkbenchSurfaceProps = PropsRuntime<'details'> & {
    workbench: WorkbenchService;
};
export declare function WorkbenchHeaderAction({ workbench }: WorkbenchHeaderActionProps): import("react").JSX.Element;
export declare function ExportHeaderAction({ sessionId, sessionExport }: ExportHeaderActionProps): import("react").JSX.Element;
export declare function WorkbenchPanel({ workbench }: WorkbenchSurfaceProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=Workbench.d.ts.map