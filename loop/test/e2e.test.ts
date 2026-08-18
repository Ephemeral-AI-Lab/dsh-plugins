import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  callCommand,
  createHarness,
  disposeAgent,
  type AgentHandle,
  type TestAgent,
} from './harness.js'

const promptDirectory = fileURLToPath(new URL('./e2e/prompts/', import.meta.url))
type Harness = Awaited<ReturnType<typeof createHarness>>

async function loadPrompt(name: string): Promise<string> {
  return readFile(join(promptDirectory, name), 'utf8')
}

async function createLoop(harness: Harness, agent: TestAgent, seconds: number, prompt: string): Promise<{ id: string }> {
  const result = await callCommand(harness.ctx, agent, `/loop ${seconds} ${prompt}`)
  expect(result?.result.kind).toBe('success')
  const text = result?.result.kind === 'success' ? result.result.text : undefined
  return JSON.parse(text ?? '{}') as { id: string }
}

function sentText(handle: AgentHandle, index = 0): string {
  const message = handle.agent.send.mock.calls[index]?.[0] as { content?: Array<{ text?: string }> } | undefined
  return message?.content?.[0]?.text ?? ''
}

async function runScenario(task: (
  harness: Harness,
  makeAgent: (id: string, status: TestAgent['status'], session?: AgentHandle['session']) => AgentHandle,
  dispose: (handle: AgentHandle) => Promise<void>,
) => Promise<void>): Promise<void> {
  const harness = await createHarness()
  const active = new Set<AgentHandle>()
  const makeAgent = (id: string, status: TestAgent['status'], session?: AgentHandle['session']) => {
    const handle = harness.makeAgent(id, status, session)
    active.add(handle)
    return handle
  }
  const dispose = async (handle: AgentHandle) => {
    if (!active.delete(handle)) return
    await disposeAgent(handle)
  }
  try {
    await task(harness, makeAgent, dispose)
  } finally {
    for (const handle of [...active].reverse()) await dispose(handle)
    await harness.dispose()
  }
}

describe('prompt-driven local DSH loop E2E', () => {
  it('SM01 one-second idle delivery and deletion', async () => {
    expect(await loadPrompt('SM01-one-second-idle.md')).toContain('LOOP_E2E_IDLE')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const agent = makeAgent('e2e-sm01', 'idle')
      const loop = await createLoop(harness, agent.agent, 1, 'LOOP_E2E_IDLE')

      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.send).toHaveBeenCalledTimes(1)
      expect(agent.agent.send.mock.calls[0]?.slice(1)).toEqual(['next-turn', true])
      expect(sentText(agent)).toContain('LOOP_E2E_IDLE')
      expect(sentText(agent)).toContain('<heartbeat>')

      await callCommand(harness.ctx, agent.agent, `/loop delete ${loop.id}`)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.send).toHaveBeenCalledTimes(1)
      await dispose(agent)
    })
  })

  it('SM02 routes a running agent through next-step', async () => {
    expect(await loadPrompt('SM02-running-agent.md')).toContain('LOOP_E2E_RUNNING')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const agent = makeAgent('e2e-sm02', 'running')
      const loop = await createLoop(harness, agent.agent, 1, 'LOOP_E2E_RUNNING')

      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.send).toHaveBeenCalledTimes(1)
      expect(agent.agent.send.mock.calls[0]?.slice(1)).toEqual(['next-step', true])
      expect(agent.agent.followup).not.toHaveBeenCalled()
      await callCommand(harness.ctx, agent.agent, `/loop delete ${loop.id}`)
      await dispose(agent)
    })
  })

  it('SM03 preserves creation order for equal deadlines', async () => {
    expect(await loadPrompt('SM03-same-deadline-order.md')).toContain('LOOP_E2E_FIRST')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const agent = makeAgent('e2e-sm03', 'idle')
      const first = await createLoop(harness, agent.agent, 1, 'LOOP_E2E_FIRST')
      const second = await createLoop(harness, agent.agent, 1, 'LOOP_E2E_SECOND')

      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.send).toHaveBeenCalledTimes(2)
      expect(sentText(agent, 0)).toContain('LOOP_E2E_FIRST')
      expect(sentText(agent, 1)).toContain('LOOP_E2E_SECOND')
      await callCommand(harness.ctx, agent.agent, `/loop delete ${first.id}`)
      await callCommand(harness.ctx, agent.agent, `/loop delete ${second.id}`)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.send).toHaveBeenCalledTimes(2)
      await dispose(agent)
    })
  })

  it('SM04 reconstructs the timer for a replacement agent', async () => {
    expect(await loadPrompt('SM04-dispose-and-resume.md')).toContain('LOOP_E2E_RESUME')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const first = makeAgent('e2e-sm04', 'idle')
      const loop = await createLoop(harness, first.agent, 1, 'LOOP_E2E_RESUME')
      const session = first.session
      await dispose(first)

      const replacement = makeAgent('e2e-sm04', 'idle', session)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(first.agent.send).not.toHaveBeenCalled()
      expect(replacement.agent.send).toHaveBeenCalledTimes(1)
      expect(sentText(replacement)).toContain('LOOP_E2E_RESUME')
      await callCommand(harness.ctx, replacement.agent, `/loop delete ${loop.id}`)
      await dispose(replacement)
    })
  })

  it('SM05 keeps deliveries isolated by session', async () => {
    expect(await loadPrompt('SM05-session-isolation.md')).toContain('LOOP_E2E_A')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const first = makeAgent('e2e-sm05-a', 'idle')
      const second = makeAgent('e2e-sm05-b', 'idle')
      const firstLoop = await createLoop(harness, first.agent, 1, 'LOOP_E2E_A')
      await createLoop(harness, second.agent, 1, 'LOOP_E2E_B')

      await vi.advanceTimersByTimeAsync(1_000)
      expect(first.agent.send).toHaveBeenCalledTimes(1)
      expect(second.agent.send).toHaveBeenCalledTimes(1)
      expect(sentText(first)).toContain('LOOP_E2E_A')
      expect(sentText(first)).not.toContain('LOOP_E2E_B')
      expect(sentText(second)).toContain('LOOP_E2E_B')

      await callCommand(harness.ctx, first.agent, `/loop delete ${firstLoop.id}`)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(first.agent.send).toHaveBeenCalledTimes(1)
      expect(second.agent.send).toHaveBeenCalledTimes(2)
      await dispose(second)
      await dispose(first)
    })
  })

  it('HD01 serializes a delete against a due drive', async () => {
    expect(await loadPrompt('HD01-delete-drive-race.md')).toContain('HARD_RACE_TARGET')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const agent = makeAgent('e2e-hd01', 'idle')
      const target = await createLoop(harness, agent.agent, 1, 'HARD_RACE_TARGET')
      await callCommand(harness.ctx, agent.agent, '/loop list')
      const flushCount = harness.flushes.length
      harness.blockNextFlush()
      vi.advanceTimersByTime(1_000)
      for (let attempt = 0; attempt < 10 && harness.flushes.length === flushCount; attempt += 1) await Promise.resolve()
      expect(harness.flushes.length).toBeGreaterThan(flushCount)

      const deletion = callCommand(harness.ctx, agent.agent, `/loop delete ${target.id}`)
      harness.releaseBlockedFlush()
      await deletion
      expect(agent.agent.send).not.toHaveBeenCalled()
      expect((await callCommand(harness.ctx, agent.agent, '/loop list'))?.result).toMatchObject({ kind: 'success', text: '[]' })

      await vi.advanceTimersByTimeAsync(2_000)
      expect(agent.agent.send).not.toHaveBeenCalled()
      const control = await createLoop(harness, agent.agent, 1, 'HARD_RACE_CONTROL')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(agent.agent.send).toHaveBeenCalledTimes(1)
      expect(sentText(agent)).toContain('HARD_RACE_CONTROL')
      await callCommand(harness.ctx, agent.agent, `/loop delete ${control.id}`)
      await dispose(agent)
    })
  })

  it('HD02 recovers after a post-dispatch persistence failure', async () => {
    expect(await loadPrompt('HD02-post-dispatch-recovery.md')).toContain('HARD_RECOVERY')
    await runScenario(async (harness, makeAgent, dispose) => {
      vi.useFakeTimers({ now: 0 })
      const first = makeAgent('e2e-hd02', 'idle')
      await createLoop(harness, first.agent, 1, 'HARD_RECOVERY')
      await callCommand(harness.ctx, first.agent, '/loop list')
      for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve()
      harness.failPostDispatchFlush()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(first.agent.send).toHaveBeenCalledTimes(1)
      expect(harness.flushFailures).toBeGreaterThan(0)
      expect(first.session.events.filter(event => event.type === 'loop/change' && event.data.operation === 'dispatch')).toHaveLength(1)

      const session = first.session
      await dispose(first)
      const recovered = makeAgent('e2e-hd02', 'idle', session)
      await vi.advanceTimersByTimeAsync(999)
      expect(recovered.agent.send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(recovered.agent.send).toHaveBeenCalledTimes(1)
      const dispatches = session.events.filter(event => event.type === 'loop/change' && event.data.operation === 'dispatch')
      expect(dispatches).toHaveLength(2)
      expect(dispatches[1]?.data.next_at).toBeGreaterThan(dispatches[0]?.data.next_at ?? 0)

      const recoveredSession = recovered.session
      await dispose(recovered)
      const resumed = makeAgent('e2e-hd02', 'idle', recoveredSession)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(resumed.agent.send).toHaveBeenCalledTimes(1)
      await dispose(resumed)
    })
  })
})
