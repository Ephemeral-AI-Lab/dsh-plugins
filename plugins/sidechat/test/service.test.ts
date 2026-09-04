import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantMessage,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SideChatRuntime, SIDECHAT_SYSTEM_PROMPT } from '../src/service.js'
import { stableMessages } from '../src/context.js'
import type { SideChatAddress, SideChatId } from '../src/types.js'

function centered() {
  const session = Session.create(SessionId('centered'), undefined, {
    version: 0,
    id: SessionId('centered'),
    createdAt: 1,
    cwd: '/repo',
    agentPreset: 'ephemeral-ai-harness',
  })
  session.append('request/header', {
    header: {
      config: { provider: 'inherited-provider', model: 'inherited-model' },
      system: 'CENTERED PRESET SYSTEM PROMPT MUST NOT BE INHERITED',
      tools: [{ name: 'send_message', description: 'must not inherit', parameters: {} }],
    },
    reason: 'initial',
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'centered question' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'centered answer' }],
      source: { provider: 'inherited-provider', model: 'inherited-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

function answer(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function harness(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>) {
  const session = centered()
  let id = 0
  const deps = {
    llm: { stream: vi.fn(stream) },
    sessions: { get: vi.fn((candidate: string) => candidate === session.id ? session : undefined) },
    sessionPersistence: { inspect: vi.fn(async () => { throw new Error('missing') }) },
    agents: { get: vi.fn(() => undefined) },
    agentDefaultModel: {
      currentSelection: vi.fn(() => ({ provider: 'default-provider', model: 'default-model' })),
    },
  }
  const runtime = new SideChatRuntime(deps as never, {
    startSweep: false,
    now: () => 10_000,
    mintId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    mintCapability: () => 'x'.repeat(43),
  })
  return { runtime, deps, session }
}

async function waitForIdle(runtime: SideChatRuntime, address: SideChatAddress): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (runtime.snapshot(address).status !== 'running') return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('sidechat did not become idle')
}

describe('SideChatRuntime', () => {
  it('inherits centered messages and model route without sessions, tools, preset composition, or log writes', async () => {
    const requests: GenerateOptions[] = []
    const { runtime, deps, session } = harness(async function * (options) {
      requests.push(options)
      yield * answer('side answer')
    })
    const before = session.events.length
    const opened = await runtime.open(String(session.id), 'Centered title')
    const address: SideChatAddress = opened

    runtime.submit({
      ...address,
      content: [{ type: 'text', text: 'side question' }],
      delivery: 'followup',
    })
    await waitForIdle(runtime, address)

    expect(session.events).toHaveLength(before)
    expect(deps.sessionPersistence.inspect).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      provider: 'inherited-provider',
      model: 'inherited-model',
      system: SIDECHAT_SYSTEM_PROMPT,
    })
    expect(requests[0]).not.toHaveProperty('tools')
    expect(requests[0]).not.toHaveProperty('sessionId')
    expect(requests[0]?.system).not.toContain('CENTERED PRESET SYSTEM PROMPT')
    expect(requests[0]?.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text))
      .toEqual(expect.arrayContaining(['centered question', 'centered answer', 'side question']))
    expect(runtime.snapshot(address).messages.map(message => message.role)).toEqual(['user', 'assistant'])
    runtime.dispose()
  })

  it('queues follow-ups FIFO while one response is active', async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    let calls = 0
    const { runtime, session } = harness(async function * () {
      calls += 1
      if (calls === 1) await first
      yield * answer(`answer-${String(calls)}`)
    })
    const opened = await runtime.open(String(session.id))
    const address: SideChatAddress = opened

    runtime.submit({ ...address, content: [{ type: 'text', text: 'one' }], delivery: 'followup' })
    runtime.submit({ ...address, content: [{ type: 'text', text: 'two' }], delivery: 'followup' })
    expect(runtime.snapshot(address)).toMatchObject({ status: 'running', queuedCount: 1 })

    releaseFirst()
    await waitForIdle(runtime, address)
    expect(runtime.snapshot(address).messages
      .filter(message => message.role === 'user')
      .map(message => message.content[0]?.text)).toEqual(['one', 'two'])
    expect(calls).toBe(2)
    runtime.dispose()
  })

  it('steers by aborting partial output, excluding it from the replacement prompt', async () => {
    const requests: GenerateOptions[] = []
    let calls = 0
    const { runtime, session } = harness(async function * (options) {
      requests.push(options)
      calls += 1
      if (calls === 1) {
        yield { type: 'text-delta', index: 0, text: 'discard this partial' }
        await new Promise<void>(resolve => {
          options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'steered', code: 'ABORTED' } } }
        return
      }
      yield * answer('replacement answer')
    })
    const opened = await runtime.open(String(session.id))
    const address: SideChatAddress = opened
    runtime.submit({ ...address, content: [{ type: 'text', text: 'initial direction' }], delivery: 'followup' })
    await new Promise(resolve => setTimeout(resolve, 0))
    runtime.submit({ ...address, content: [{ type: 'text', text: 'new direction' }], delivery: 'steer' })
    await waitForIdle(runtime, address)

    const snapshot = runtime.snapshot(address)
    expect(snapshot.messages.some(message => message.interrupted)).toBe(true)
    expect(requests).toHaveLength(2)
    const replacementText = requests[1]?.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text)
    expect(replacementText).toContain('new direction')
    expect(replacementText).not.toContain('discard this partial')
    runtime.dispose()
  })

  it('closes and recycles memory without exposing an address lookup', async () => {
    let now = 0
    const { runtime, session } = harness(async function * () { yield * answer('ok') })
    ;(runtime as unknown as { now: () => number }).now = () => now
    const opened = await runtime.open(String(session.id))
    const address: SideChatAddress = opened

    expect(() => runtime.snapshot({ ...address, capability: 'bad'.repeat(20) })).toThrow('unavailable')
    runtime.close(address)
    expect(() => runtime.snapshot(address)).toThrow('unavailable')

    const second = await runtime.open(String(session.id))
    now = 31 * 60 * 1000
    expect(runtime.collectExpired(now)).toBe(1)
    expect(() => runtime.snapshot(second)).toThrow('unavailable')
    runtime.dispose()
  })
})

describe('stableMessages', () => {
  it('cuts an open step from inherited context', () => {
    const session = centered()
    session.append('turn/start', { turn: 2 })
    session.append('step/start', { turn: 2, step: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'unfinished prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const stable = stableMessages(session.events)

    expect(stable.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text))
      .not.toContain('unfinished prompt')
  })
})
