import { fileURLToPath } from 'node:url'
import type { ExecResult, ResolvedConfig, SessionOwner, ShellAdapter } from '../../src/types.js'
import { createPipeBackend } from '../../src/backend/pipe-backend.js'
import { ExecSessionService } from '../../src/session/exec-session-service.js'
import { registerExecCommandTool } from '../../src/tools/exec-command.js'
import { registerWriteStdinTool } from '../../src/tools/write-stdin.js'

export type SimulatedAgent = SessionOwner & {
  ctx: { effect(body: () => () => Promise<void>): void }
  cleanup?: () => Promise<void>
}

export type RegisteredTool = {
  readonly name: string
  readonly parameters: {
    readonly properties: Record<string, unknown>
    readonly required: readonly string[]
  }
  readonly output: {
    render(args: unknown, value: ExecResult): Array<{ type: 'text'; text: string }>
  }
  execute(args: unknown, exec: { agent?: object; signal: AbortSignal }): Promise<ExecResult>
}

export type SimulatedToolResult = {
  readonly isError: boolean
  readonly value?: ExecResult
  readonly content: Array<{ type: 'text'; text: string }>
}

const fixture = fileURLToPath(new URL('../fixtures/registered-tool-child.mjs', import.meta.url))

const config: ResolvedConfig = {
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 8,
  defaultYieldTimeMs: 25,
  pollYieldTimeMs: 5,
  maxOutputBytes: 16_384,
  defaultMaxOutputTokens: 1_000,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000,
}

const shell: ShellAdapter = {
  async resolve() {
    return { executable: process.execPath, oneShotArgs: command => [fixture, command], interactiveArgs: () => [] }
  },
  oneShotArgs: command => [fixture, command],
  interactiveArgs: () => [],
}

export function createRegisteredToolHarness(jobs?: unknown): {
  service: ExecSessionService
  execCommand: RegisteredTool
  writeStdin: RegisteredTool
  agent(name: string): SimulatedAgent
} {
  const registered: RegisteredTool[] = []
  const service = new ExecSessionService(config, shell, createPipeBackend, undefined, jobs as never)
  const ctx = { tools: { register(tool: RegisteredTool): void { registered.push(tool) } } }
  registerExecCommandTool(ctx as never, service)
  registerWriteStdinTool(ctx as never, service)
  const execCommand = registered.find(tool => tool.name === 'exec_command')
  const writeStdin = registered.find(tool => tool.name === 'write_stdin')
  if (execCommand === undefined || writeStdin === undefined) throw new Error('registered command tools are incomplete')

  return {
    service,
    execCommand,
    writeStdin,
    agent(name) {
      const owner: SimulatedAgent = {
        ownerId: name,
        ctx: {
          effect(body) {
            owner.cleanup = body()
          },
        },
      }
      return owner
    },
  }
}

export function execution(agent?: SimulatedAgent): { agent?: SimulatedAgent; signal: AbortSignal } {
  return { ...(agent === undefined ? {} : { agent }), signal: new AbortController().signal }
}

export async function callTool(
  tool: RegisteredTool,
  args: unknown,
  exec: { agent?: object; signal: AbortSignal },
): Promise<SimulatedToolResult> {
  try {
    const value = await tool.execute(args, exec)
    return { isError: false, value, content: tool.output.render(args, value) }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] }
  }
}
