import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { ShellAdapter, ShellResolution } from '../types.js'

export class PosixShellAdapter implements ShellAdapter {
  private resolution: ShellResolution | undefined

  constructor(private readonly configuredExecutable?: string) {}

  async resolve(): Promise<ShellResolution> {
    if (this.resolution !== undefined) return this.resolution
    const candidates = [
      this.configuredExecutable,
      process.env.SHELL,
      process.platform === 'darwin' ? '/bin/zsh' : undefined,
      '/bin/bash',
      '/bin/sh',
    ].filter((value): value is string => value !== undefined && value.length > 0)
    for (const executable of candidates) {
      try {
        await access(executable, constants.X_OK)
        this.resolution = {
          executable,
          oneShotArgs: command => ['-c', command],
          interactiveArgs: () => ['-i'],
        }
        return this.resolution
      } catch {
        // Keep trying the ordered fallback list.
      }
    }
    throw new Error('No supported POSIX shell was found')
  }

  oneShotArgs(command: string): readonly string[] {
    return ['-c', command]
  }

  interactiveArgs(): readonly string[] {
    return ['-i']
  }
}
