import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ExecResult, WriteStdinArgs } from '../types.js'
import type { ExecSessionService } from '../session/exec-session-service.js'

export function registerWriteStdinTool(ctx: Context, service: ExecSessionService): void {
  ctx.tools.register(defineTool({
    name: 'write_stdin',
    description: 'Write characters to an existing exec session or poll its output.',
    parameters: {
      session_id: { type: 'number', required: true, description: 'Opaque session identifier returned by exec_command.' },
      chars: { type: 'string', description: 'Characters to write. Omit or use an empty string to poll.' },
      yield_time_ms: { type: 'number', description: 'Maximum time to wait for output. Defaults to the configured poll interval.' },
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
    async execute(args: WriteStdinArgs, exec): Promise<ExecResult> {
      validateWriteArgs(args)
      return service.write({
        owner: service.ownerFor(exec.agent),
        sessionId: args.session_id,
        chars: args.chars ?? '',
        ...args.yield_time_ms === undefined ? {} : { yieldTimeMs: args.yield_time_ms },
        ...args.max_output_tokens === undefined ? {} : { maxOutputTokens: args.max_output_tokens },
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'terminal', title: `write_stdin ${args.session_id}` }),
  }))
}

function validateWriteArgs(args: WriteStdinArgs): void {
  if (!Number.isSafeInteger(args.session_id) || args.session_id <= 0) {
    throw new Error('session_id must be a positive integer')
  }
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
