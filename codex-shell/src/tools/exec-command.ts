import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ExecCommandArgs, ExecResult } from '../types.js'
import type { ExecSessionService } from '../session/exec-session-service.js'

export function registerExecCommandTool(ctx: Context, service: ExecSessionService): void {
  ctx.tools.register(defineTool({
    name: 'exec_command',
    description: 'Run a command in the host shell and return output or a session ID for ongoing interaction.',
    parameters: {
      cmd: { type: 'string', required: true, description: 'Shell command to execute.' },
      workdir: { type: 'string', description: 'Working directory for the command.' },
      yield_time_ms: { type: 'number', description: 'Maximum time to wait before returning a live session ID. Defaults to 10000 ms.' },
      max_output_tokens: { type: 'number', description: 'Maximum output token budget. Defaults to the configured limit.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
          wall_time_seconds: { type: 'number', required: true },
          session_id: { type: 'integer' },
          exit_code: { type: 'integer' },
          chunk_id: { type: 'string' },
          original_token_count: { type: 'integer' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderOutput(value) }],
    },
    async execute(args: ExecCommandArgs, exec): Promise<ExecResult> {
      validateCommandArgs(args)
      return service.exec({
        owner: service.ownerFor(exec.agent),
        cmd: args.cmd,
        ...args.workdir === undefined ? {} : { workdir: args.workdir },
        ...args.yield_time_ms === undefined ? {} : { yieldTimeMs: args.yield_time_ms },
        ...args.max_output_tokens === undefined ? {} : { maxOutputTokens: args.max_output_tokens },
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'terminal', title: args.cmd, ...args.workdir === undefined ? {} : { cwd: args.workdir } }),
  }))
}

function validateCommandArgs(args: ExecCommandArgs): void {
  if (args.cmd.trim().length === 0) throw new Error('cmd must be a non-empty string')
  if (args.yield_time_ms !== undefined && (!Number.isFinite(args.yield_time_ms) || args.yield_time_ms < 0)) {
    throw new Error('yield_time_ms must be a non-negative finite number')
  }
  if (args.max_output_tokens !== undefined && (!Number.isFinite(args.max_output_tokens) || args.max_output_tokens <= 0)) {
    throw new Error('max_output_tokens must be a positive finite number')
  }
}

function renderOutput(value: ExecResult): string {
  const session = value.session_id === undefined ? '' : `\n[session_id: ${value.session_id}]`
  const marker = value.exit_code !== undefined && value.exit_code !== 0 ? `\n[exit code: ${value.exit_code}]` : ''
  return value.output + session + marker
}
