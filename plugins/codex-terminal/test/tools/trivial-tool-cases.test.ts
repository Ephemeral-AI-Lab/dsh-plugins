import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution } from '../support/registered-tools.js'

describe('trivial registered tool cases', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>

  beforeEach(() => {
    harness = createRegisteredToolHarness()
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('rejects a blank exec_command', async () => {
    const result = await callTool(harness.execCommand, { cmd: '   ' }, execution())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('cmd must be a non-empty string')
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('rejects a negative exec_command wait', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: -1 }, execution())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('yield_time_ms must be a non-negative finite number')
  })

  it('rejects a zero exec_command output limit', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', max_output_tokens: 0 }, execution())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('max_output_tokens must be a positive finite number')
  })

  it('rejects an invalid write_stdin job id', async () => {
    const result = await callTool(harness.writeStdin, { job_id: 'invalid' }, execution())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('job_id must be a codex-terminal job id')
  })

  it('rejects a negative write_stdin wait', async () => {
    const result = await callTool(harness.writeStdin, { job_id: 'codex-terminal-1', yield_time_ms: -1 }, execution())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('yield_time_ms must be a non-negative finite number')
  })

  it('returns foreground stdout with exit code zero', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.output).toBe('PASS foreground\n')
    expect(result.value?.exit_code).toBe(0)
    expect(result.value?.job_id).toBeUndefined()
  })

  it('returns foreground stderr with exit code one', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'fail', yield_time_ms: 1_000 }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.output).toBe('FAIL simulated command\n')
    expect(result.value?.exit_code).toBe(1)
    expect(result.value?.job_id).toBeUndefined()
  })

  it('returns timing and chunk metadata for a foreground result', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution())

    expect(result.value?.wall_time_seconds).toBeTypeOf('number')
    expect(result.value?.wall_time_seconds).toBeGreaterThanOrEqual(0)
    expect(result.value?.chunk_id).toBe('1-1')
  })

  it('renders successful output without an exit marker', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution())

    expect(result.content[0]?.text).toBe('PASS foreground\n')
    expect(result.content[0]?.text).not.toContain('[exit code:')
  })

  it('renders failed output with its exit marker', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'fail', yield_time_ms: 1_000 }, execution())

    expect(result.content[0]?.text).toBe('FAIL simulated command\n\n[exit code: 1]')
  })

  it('returns a job id for a running command', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'interactive:session', yield_time_ms: 1_000 }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.output).toContain('READY session')
    expect(result.value?.job_id).toBeTypeOf('string')
    expect(result.value?.job_id).toMatch(/^codex-terminal-[1-9]\d*$/)
    expect(result.value?.exit_code).toBeUndefined()
    expect(result.content[0]?.text).toContain(`[job_id: ${result.value?.job_id}]`)
  })

  it('keeps the job id when an empty write polls a running command', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:poll', yield_time_ms: 0 }, execution())
    const jobId = started.value?.job_id
    const result = await callTool(harness.writeStdin, {
      job_id: jobId,
      chars: '',
      yield_time_ms: 0,
    }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.job_id).toBe(jobId)
    expect(result.value?.exit_code).toBeUndefined()
    expect(result.content[0]?.text).toContain(`[job_id: ${jobId}]`)
  })

  it('completes with PASS after one write', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:pass', yield_time_ms: 0 }, execution())
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.output).toContain('PASS pass')
    expect(result.value?.exit_code).toBe(0)
    expect(result.value?.job_id).toBeUndefined()
  })

  it('completes with FAIL after one write', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:fail', yield_time_ms: 0 }, execution())
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: 'FAIL\n',
      yield_time_ms: 1_000,
    }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.output).toContain('FAIL fail')
    expect(result.value?.exit_code).toBe(1)
    expect(result.value?.job_id).toBeUndefined()
  })

  it('treats omitted chars as an empty poll', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:omitted', yield_time_ms: 0 }, execution())
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      yield_time_ms: 0,
    }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.job_id).toBe(started.value?.job_id)
    expect(result.value?.exit_code).toBeUndefined()
  })

  it('returns fixture error output with exit code one', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'unknown', yield_time_ms: 1_000 }, execution())

    expect(result.isError).toBe(false)
    expect(result.value?.output).toContain('FAIL unknown fixture mode: unknown')
    expect(result.value?.exit_code).toBe(1)
  })

  it('preserves the fixture output newline', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution())

    expect(result.value?.output.endsWith('\n')).toBe(true)
    expect(result.content[0]?.text.endsWith('\n')).toBe(true)
  })

  it('reports an unknown session as a write_stdin error', async () => {
    const result = await callTool(harness.writeStdin, { job_id: 'codex-terminal-999', chars: '' }, execution())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unknown or completed exec job codex-terminal-999')
  })

  it('reports a completed session as unavailable for writing', async () => {
    const completed = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution())
    const result = await callTool(harness.writeStdin, { job_id: 'codex-terminal-1', chars: '' }, execution())

    expect(completed.value?.exit_code).toBe(0)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unknown or completed')
  })

  it('removes a foreground session after returning its final result', async () => {
    const result = await callTool(harness.execCommand, { cmd: 'foreground', yield_time_ms: 1_000 }, execution())

    expect(result.value?.exit_code).toBe(0)
    expect(harness.service.liveSessionCount).toBe(0)
  })
})
