import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delay } from '../../src/session/lifecycle.js'
import {
  callTool,
  createRegisteredToolHarness,
  execution,
  type SimulatedAgent,
} from '../support/registered-tools.js'

describe('automatic background-job promotion', () => {
  let hooks: { cancel(reason?: string): void; done: Promise<{ status: string; detail?: string }> } | undefined
  let startedSpec: { kind: string; label: string } | undefined
  const jobs = {
    start(spec: { kind: string; label: string; run(): NonNullable<typeof hooks> }): string {
      startedSpec = spec
      hooks = spec.run()
      return 'codex-terminal-1'
    },
    async wait(): Promise<void> {
      await hooks?.done
    },
  }
  let harness: ReturnType<typeof createRegisteredToolHarness>
  let agent: SimulatedAgent

  beforeEach(() => {
    hooks = undefined
    startedSpec = undefined
    harness = createRegisteredToolHarness(jobs)
    agent = harness.agent('background-owner')
  })

  afterEach(async () => {
    await harness.service.dispose()
  })

  it('promotes a command that outlives yield_time_ms and names both ids', async () => {
    const started = await callTool(
      harness.execCommand,
      { cmd: 'slow', yield_time_ms: 0 },
      execution(agent),
    )

    expect(started.value).toMatchObject({ job_id: 'codex-terminal-1' })
    expect(started.content[0]?.text).toContain('[job_id: codex-terminal-1]')
    expect(startedSpec).toMatchObject({
      kind: 'codex-terminal',
      label: 'slow',
    })
  })

  it('settles the tracked job, steers its owner, and keeps terminal polls idempotent', async () => {
    const steer = vi.fn()
    Object.assign(agent, { steer })
    const started = await callTool(
      harness.execCommand,
      { cmd: 'slow', yield_time_ms: 0 },
      execution(agent),
    )

    await delay(250)
    await expect(hooks?.done).resolves.toEqual({ status: 'completed', detail: 'exit code: 0' })
    expect(steer).toHaveBeenCalledWith(expect.objectContaining({
      content: [{
        type: 'text',
        text: 'exec job codex-terminal-1 exited with code 0. Call write_stdin with job_id="codex-terminal-1" and chars="" to collect the remaining output.',
      }],
    }))

    const first = await callTool(harness.writeStdin, {
      job_id: started.value?.job_id,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))
    expect(first.isError).toBe(false)
    expect(first.value).toMatchObject({ output: expect.stringContaining('PASS slow'), exit_code: 0 })
    expect(first.content[0]?.text).toContain('[job codex-terminal-1 exited with code 0]')

    const repeated = await callTool(harness.writeStdin, {
      job_id: started.value?.job_id,
      chars: '',
      yield_time_ms: 0,
    }, execution(agent))
    expect(repeated.isError).toBe(false)
    expect(repeated.value).toMatchObject({ output: '', exit_code: 0 })
    expect(repeated.content[0]?.text).toBe('[job codex-terminal-1 exited with code 0; no unread output remains]')
  })

  it('does not create a job for a command that finishes inside the yield window', async () => {
    const result = await callTool(
      harness.execCommand,
      { cmd: 'foreground', yield_time_ms: 1_000 },
      execution(agent),
    )

    expect(result.value).toMatchObject({ exit_code: 0 })
    expect(result.value?.job_id).toBeUndefined()
    expect(startedSpec).toBeUndefined()
  })

  it('maps job cancellation onto the underlying exec session', async () => {
    const steer = vi.fn()
    Object.assign(agent, { steer })
    const started = await callTool(
      harness.execCommand,
      { cmd: 'interactive:job-kill', yield_time_ms: 0 },
      execution(agent),
    )
    expect(started.value).toMatchObject({ job_id: 'codex-terminal-1' })

    hooks?.cancel('no longer needed')
    await expect(hooks?.done).resolves.toMatchObject({ status: 'killed' })
    expect(steer).not.toHaveBeenCalled()

    const collected = await callTool(harness.writeStdin, {
      job_id: 'codex-terminal-1',
      chars: '',
      yield_time_ms: 1_000,
    }, execution(agent))
    expect(collected.isError).toBe(false)
    expect(collected.value?.exit_code).toBeTypeOf('number')
  })

  it('does not notify when write_stdin delivers the terminal result inside its yield', async () => {
    const steer = vi.fn()
    Object.assign(agent, { steer })
    const started = await callTool(
      harness.execCommand,
      { cmd: 'interactive:write-completes', yield_time_ms: 0 },
      execution(agent),
    )

    const completed = await callTool(harness.writeStdin, {
      job_id: started.value?.job_id,
      chars: 'PASS\n',
      yield_time_ms: 1_000,
    }, execution(agent))
    await delay(0)

    expect(completed.isError).toBe(false)
    expect(completed.value).toMatchObject({
      output: expect.stringContaining('PASS write-completes'),
      exit_code: 0,
    })
    await expect(hooks?.done).resolves.toEqual({ status: 'completed', detail: 'exit code: 0' })
    expect(steer).not.toHaveBeenCalled()
  })
})
