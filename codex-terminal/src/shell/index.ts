import type { ShellAdapter } from '../types.js'
import { PosixShellAdapter } from './posix-shell.js'
import { WindowsPowerShellAdapter } from './windows-powershell.js'

export function createShellAdapter(config: { windowsShell?: string; posixShell?: string }): ShellAdapter {
  return process.platform === 'win32'
    ? new WindowsPowerShellAdapter(config.windowsShell)
    : new PosixShellAdapter(config.posixShell)
}
