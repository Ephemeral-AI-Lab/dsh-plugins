import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export type { WorkbenchItem, WorkbenchPanelProps, WorkbenchRegistryOptions, WorkbenchService, WorkbenchSnapshot, } from './registry.js';
export { WorkbenchRegistry } from './registry.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        workbench: import('./registry.js').WorkbenchService;
    }
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map