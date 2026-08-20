import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ExecResult, WriteStdinArgs } from '../types.js'
import type { ExecSessionService } from '../session/exec-session-service.js'

export function registerWriteStdinTool(ctx: Context, service: ExecSessionService): void {
  ctx.tools.register(defineTool({
    name: 'write_stdin',
    description: 'Write characters to an existing exec session or poll its output.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'Opaque codex-shell job identifier returned by exec_command.' },
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
          job_id: { type: 'string' },
          exit_code: { type: 'integer' },
          chunk_id: { type: 'string' },
          original_token_count: { type: 'integer' },
          truncated: { type: 'boolean' },
          already_collected: { type: 'boolean' },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderOutput(value, args.job_id) }],
    },
    async execute(args: WriteStdinArgs, exec): Promise<ExecResult> {
      validateWriteArgs(args)
      return service.write({
        owner: service.ownerFor(exec.agent),
        jobId: args.job_id,
        chars: args.chars ?? '',
        ...args.yield_time_ms === undefined ? {} : { yieldTimeMs: args.yield_time_ms },
        ...args.max_output_tokens === undefined ? {} : { maxOutputTokens: args.max_output_tokens },
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'terminal', title: `write_stdin ${args.job_id}` }),
  }))
}

function validateWriteArgs(args: WriteStdinArgs): void {
  if (!/^codex-shell-[1-9]\d*$/.test(args.job_id)) {
    throw new Error('job_id must be a codex-shell job id such as codex-shell-1')
  }
  if (args.yield_time_ms !== undefined && (!Number.isFinite(args.yield_time_ms) || args.yield_time_ms < 0)) {
    throw new Error('yield_time_ms must be a non-negative finite number')
  }
  if (args.max_output_tokens !== undefined && (!Number.isFinite(args.max_output_tokens) || args.max_output_tokens <= 0)) {
    throw new Error('max_output_tokens must be a positive finite number')
  }
}

function renderOutput(value: ExecResult, jobId?: string): string {
  const lines: string[] = []
  if (value.job_id !== undefined) lines.push(`[job_id: ${value.job_id}]`)
  const completion = value.exit_code === undefined || jobId === undefined
    ? ''
    : value.exit_code !== 0 && value.already_collected !== true
      ? `[exit code: ${value.exit_code}]`
      : `[job ${jobId} exited with code ${value.exit_code}${value.already_collected === true ? '; no unread output remains' : ''}]`
  if (completion.length > 0) lines.push(completion)
  if (lines.length === 0) return value.output
  return value.output + (value.output.length === 0 || value.output.endsWith('\n') ? '' : '\n') + lines.join('\n')
}
