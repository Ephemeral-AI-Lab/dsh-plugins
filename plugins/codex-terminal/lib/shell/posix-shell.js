import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
export class PosixShellAdapter {
    configuredExecutable;
    resolution;
    constructor(configuredExecutable) {
        this.configuredExecutable = configuredExecutable;
    }
    async resolve() {
        if (this.resolution !== undefined)
            return this.resolution;
        const candidates = [
            this.configuredExecutable,
            process.env.SHELL,
            process.platform === 'darwin' ? '/bin/zsh' : undefined,
            '/bin/bash',
            '/bin/sh',
        ].filter((value) => value !== undefined && value.length > 0);
        for (const executable of candidates) {
            try {
                await access(executable, constants.X_OK);
                this.resolution = {
                    executable,
                    oneShotArgs: command => ['-c', command],
                    interactiveArgs: () => ['-i'],
                };
                return this.resolution;
            }
            catch {
                // Keep trying the ordered fallback list.
            }
        }
        throw new Error('No supported POSIX shell was found');
    }
    oneShotArgs(command) {
        return ['-c', command];
    }
    interactiveArgs() {
        return ['-i'];
    }
}
//# sourceMappingURL=posix-shell.js.map