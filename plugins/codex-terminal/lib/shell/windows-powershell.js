import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
export class WindowsPowerShellAdapter {
    configuredExecutable;
    resolution;
    constructor(configuredExecutable) {
        this.configuredExecutable = configuredExecutable;
    }
    async resolve() {
        if (this.resolution !== undefined)
            return this.resolution;
        const candidates = this.configuredExecutable !== undefined
            ? [this.configuredExecutable]
            : ['pwsh.exe', 'powershell.exe', process.env.ComSpec ?? 'cmd.exe'];
        for (const candidate of candidates) {
            const executable = await findExecutable(candidate);
            if (executable !== undefined) {
                this.resolution = createResolution(executable);
                return this.resolution;
            }
        }
        throw new Error('No supported Windows shell was found (tried configured shell, pwsh.exe, powershell.exe, and cmd.exe)');
    }
    oneShotArgs(command) {
        return createResolution(this.configuredExecutable ?? 'pwsh.exe').oneShotArgs(command);
    }
    interactiveArgs() {
        return createResolution(this.configuredExecutable ?? 'pwsh.exe').interactiveArgs();
    }
}
function createResolution(executable) {
    const base = executable.toLowerCase().replaceAll('\\', '/').split('/').at(-1) ?? executable;
    if (base === 'cmd.exe' || base === 'cmd') {
        return {
            executable,
            oneShotArgs: command => ['/D', '/S', '/C', command],
            interactiveArgs: () => ['/D'],
        };
    }
    return {
        executable,
        oneShotArgs: command => [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + command,
        ],
        interactiveArgs: () => ['-NoLogo', '-NoProfile', '-NoExit'],
    };
}
async function findExecutable(candidate) {
    if (isAbsolute(candidate)) {
        try {
            await access(candidate);
            return candidate;
        }
        catch {
            return undefined;
        }
    }
    const pathValue = process.env.Path ?? process.env.PATH ?? '';
    for (const directory of pathValue.split(delimiter)) {
        if (directory.length === 0)
            continue;
        const path = join(directory, candidate);
        try {
            await access(path);
            return path;
        }
        catch {
            // Continue to the next PATH entry.
        }
    }
    return undefined;
}
//# sourceMappingURL=windows-powershell.js.map