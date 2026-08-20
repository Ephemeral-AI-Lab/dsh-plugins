import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'
import { delay } from '../../src/session/lifecycle.js'

describe('registered exec session output retention', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('retention-tool-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('lets the next empty write_stdin poll retrieve output emitted after exec_command returned', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const jobId = started.value?.job_id
    expect(jobId).toBeTypeOf('string')

    await delay(250)
    const result = await callTool(harness.writeStdin, {
      job_id: jobId,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
  })

  it('keeps naturally exited output available until the empty poll delivers it', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const jobId = started.value?.job_id
    expect(jobId).toBeTypeOf('string')

    await delay(250)
    expect(harness.service.liveSessionCount).toBe(1)

    const result = await callTool(harness.writeStdin, {
      job_id: jobId,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))

    expect(result.value?.exit_code).toBe(0)
    expect(harness.service.liveSessionCount).toBe(0)
  })

  it('does not lose the final result when write_stdin is attempted after natural exit', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'slow', yield_time_ms: 0 }, execution(agent))
    const jobId = started.value?.job_id
    expect(jobId).toBeTypeOf('string')

    await delay(250)
    const lateWrite = await callTool(harness.writeStdin, {
      job_id: jobId,
      chars: 'late-input',
      yield_time_ms: 0,
    }, execution(agent))
    expect(lateWrite.isError).toBe(true)

    const result = await callTool(harness.writeStdin, {
      job_id: jobId,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
  })
})
