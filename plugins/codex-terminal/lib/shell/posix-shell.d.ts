import type { ShellAdapter, ShellResolution } from '../types.js';
export declare class PosixShellAdapter implements ShellAdapter {
    private readonly configuredExecutable?;
    private resolution;
    constructor(configuredExecutable?: string | undefined);
    resolve(): Promise<ShellResolution>;
    oneShotArgs(command: string): readonly string[];
    interactiveArgs(): readonly string[];
}
//# sourceMappingURL=posix-shell.d.ts.map