import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callTool, createRegisteredToolHarness, execution, type SimulatedAgent } from '../support/registered-tools.js'

describe('write_stdin input delivery', () => {
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    harness = createRegisteredToolHarness()
    agent = harness.agent('stdin-agent')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('delivers correct input and returns the final PASS result', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:stdin', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('PASS stdin'), exit_code: 0 })
    expect(result.value?.job_id).toBeUndefined()
  })

  it('delivers incorrect input and preserves the FAIL result with exit code one', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:wrong', yield_time_ms: 0 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: 'FAIL\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ output: expect.stringContaining('FAIL wrong'), exit_code: 1 })
    expect(result.value?.job_id).toBeUndefined()
  })

  it('serializes multiple input writes in order', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:chunks', yield_time_ms: 0 }, execution(agent))
    const first = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: 'PA',
      yield_time_ms: 0,
    }, execution(agent))
    const second = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: 'SS\n',
      yield_time_ms: 1_000,
    }, execution(agent))

    expect(first.isError).toBe(false)
    expect(first.value?.job_id).toBeTypeOf('string')
    expect(second.value).toMatchObject({ output: expect.stringContaining('PASS chunks'), exit_code: 0 })
  })

  it('polls without writing when chars is empty', async () => {
    const started = await callTool(harness.execCommand, { cmd: 'interactive:poll-empty', yield_time_ms: 1_000 }, execution(agent))
    const result = await callTool(harness.writeStdin, {
      job_id: started.value!.job_id,
      chars: '',
      yield_time_ms: 25,
    }, execution(agent))

    expect(result.isError).toBe(false)
    expect(result.value?.job_id).toBeTypeOf('string')
    expect(result.value?.exit_code).toBeUndefined()
  })
})
