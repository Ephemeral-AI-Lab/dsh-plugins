import type { ComponentType, ReactNode } from 'react';
export interface WorkbenchPanelProps {
    close: () => void;
}
export interface WorkbenchItem {
    id: string;
    label: string;
    component: ComponentType<WorkbenchPanelProps>;
    icon?: ReactNode;
    order?: number;
}
export interface WorkbenchSnapshot {
    open: boolean;
    activeId: string | null;
    items: readonly WorkbenchItem[];
}
export interface WorkbenchService {
    register(item: WorkbenchItem): () => void;
    open(id: string): void;
    close(): void;
    toggle(id?: string): void;
    getSnapshot(): WorkbenchSnapshot;
    subscribe(listener: () => void): () => void;
}
export interface WorkbenchRegistryOptions {
    onOpen?: () => void;
    onClose?: () => void;
}
export declare class WorkbenchRegistry implements WorkbenchService {
    private readonly options;
    private readonly entries;
    private readonly listeners;
    private snapshot;
    constructor(options?: WorkbenchRegistryOptions);
    register(item: WorkbenchItem): () => void;
    open(id: string): void;
    close(): void;
    toggle(id?: string): void;
    getSnapshot: () => WorkbenchSnapshot;
    subscribe: (listener: () => void) => (() => void);
    private publish;
}
//# sourceMappingURL=registry.d.ts.map