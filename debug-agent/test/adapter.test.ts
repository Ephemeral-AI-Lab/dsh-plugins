import { describe, expect, it } from 'vitest'
import {
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockDebugAdapter } from '../src/mock-adapter.js'
import { validateDebugScript } from '../src/converter.js'

const session = (id: string): GenerateOptions['sessionId'] => id as GenerateOptions['sessionId']

function request(text: string, id?: string): GenerateOptions {
  return {
    provider: 'mock-debug',
    model: 'debug',
    messages: [createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })],
    ...(id === undefined ? {} : { sessionId: session(id) }),
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function toolCall(chunks: StreamChunk[]): Extract<StreamChunk, { type: 'block-end' }>['block'] {
  const chunk = chunks.find(candidate => candidate.type === 'block-end' && candidate.block.type === 'tool-call')
  if (chunk?.block.type !== 'tool-call') throw new Error('expected one tool call')
  return chunk.block
}

describe('MockDebugAdapter', () => {
  it('emits one normal tool-call block for valid input', async () => {
    const adapter = new MockDebugAdapter()
    const chunks = await collect(adapter.stream(request('exec_command({"cmd":"Get-Location"})', 'one')))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: expect.stringMatching(/^debug-/),
          name: 'exec_command',
          arguments: '{"cmd":"Get-Location"}',
        },
      },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
    expect(adapter.pendingSessionCount).toBe(1)
  })

  it('emits unknown tools without consulting a registry', async () => {
    const adapter = new MockDebugAdapter()
    const block = toolCall(await collect(adapter.stream(request('does_not_exist({})', 'unknown'))))
    expect(block.name).toBe('does_not_exist')
    expect(block.arguments).toBe('{}')
  })

  it('finds the user command when later plugin context is present', async () => {
    const adapter = new MockDebugAdapter()
    const chunks = await collect(adapter.stream({
      ...request('exec_command({"cmd":"Get-Location"})', 'context'),
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: 'exec_command({"cmd":"Get-Location"})' }],
          source: { kind: 'user' },
        }),
        createUserMessage({
          content: [{ type: 'text', text: 'workspace context' }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
    }))
    expect(toolCall(chunks).name).toBe('exec_command')
  })

  it('does not let auxiliary model calls consume a pending debug plan', async () => {
    const fallbackStream = (): AsyncIterable<StreamChunk> => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'auxiliary response' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
    const adapter = new MockDebugAdapter(undefined, () => fallbackStream())
    const first = await collect(adapter.stream(request('tool_a({})', 'auxiliary')))
    const firstCall = toolCall(first)

    const auxiliary = await collect(adapter.stream({
      ...request('', 'auxiliary'),
      purpose: 'session-title',
    }))
    expect(auxiliary).toEqual([
      { type: 'text-delta', index: 0, text: 'auxiliary response' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(adapter.pendingSessionCount).toBe(1)

    const result = createToolResultMessage({
      callId: firstCall.id,
      content: [{ type: 'text', text: 'RESULT' }],
      isError: false,
    })
    const next = await collect(adapter.stream({ ...request('', 'auxiliary'), messages: [result] }))
    expect(next.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('Debug run completed (1 executable step).'))).toBe(true)
    expect(next.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('RESULT'))).toBe(false)
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('reports malformed input as text and does not emit a tool call', async () => {
    const adapter = new MockDebugAdapter()
    const chunks = await collect(adapter.stream(request("exec_command({'cmd':'bad'})", 'bad')))
    expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')).toBe(false)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('Invalid debug command'))).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('keeps call state isolated by session and releases it after each result', async () => {
    const adapter = new MockDebugAdapter()
    const first = await collect(adapter.stream(request('tool_a({"value":"a"})', 'a')))
    const second = await collect(adapter.stream(request('tool_b({"value":"b"})', 'b')))
    const firstCall = toolCall(first)
    const secondCall = toolCall(second)
    expect(firstCall.name).toBe('tool_a')
    expect(secondCall.name).toBe('tool_b')
    expect(firstCall.id).not.toBe(secondCall.id)
    expect(adapter.pendingSessionCount).toBe(2)

    const firstResult = createToolResultMessage({
      callId: firstCall.id,
      content: [{ type: 'text', text: 'A_RESULT' }],
      isError: false,
    })
    const secondResult = createToolResultMessage({
      callId: secondCall.id,
      content: [{ type: 'text', text: 'B_RESULT' }],
      isError: false,
    })
    const firstSummary = await collect(adapter.stream({ ...request('', 'a'), messages: [firstResult] }))
    const secondSummary = await collect(adapter.stream({ ...request('', 'b'), messages: [secondResult] }))
    expect(firstSummary.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('Debug run completed (1 executable step).'))).toBe(true)
    expect(secondSummary.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('Debug run completed (1 executable step).'))).toBe(true)
    expect(firstSummary.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('A_RESULT'))).toBe(false)
    expect(secondSummary.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('B_RESULT'))).toBe(false)
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('returns an aborted finish for a cancelled request', async () => {
    const adapter = new MockDebugAdapter()
    const controller = new AbortController()
    controller.abort('cancelled')
    const chunks = await collect(adapter.stream({ ...request('tool_a({})', 'cancelled'), signal: controller.signal }))
    expect(chunks).toEqual([{
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'debug request aborted', code: 'ABORTED' } },
    }])
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('fails deterministically when a tool result has the wrong correlation id', async () => {
    const adapter = new MockDebugAdapter()
    const first = await collect(adapter.stream(request('tool_a({})', 'mismatch')))
    const call = toolCall(first)
    adapter.noteToolResult('mismatch', call.id, { isError: false }, 'different-call')

    const next = await collect(adapter.stream(request('', 'mismatch')))
    expect(next.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: expect.stringContaining('correlated to different-call'),
          code: 'DEBUG_PROTOCOL',
        },
      },
    })
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('wakes a result waiter when its session is cleared', async () => {
    const adapter = new MockDebugAdapter()
    const first = await collect(adapter.stream(request('tool_a({})', 'cleared')))
    expect(toolCall(first).name).toBe('tool_a')
    const waiting = collect(adapter.stream(request('', 'cleared')))
    await new Promise(resolve => setTimeout(resolve, 0))
    adapter.clearSession('cleared')

    const chunks = await waiting
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'aborted' },
    })
    expect(adapter.pendingWaitCount).toBe(0)
  })

  it('cancels an explicit wait and releases the plan and timer', async () => {
    const states: string[] = []
    const adapter = new MockDebugAdapter(event => {
      if (event.kind === 'state') states.push(event.state.phase)
    })
    adapter.startPlan({
      sessionId: 'wait-cancel',
      runId: 'run-wait-cancel',
      mode: 'replay',
      script: validateDebugScript({
        type: 'dsh-debug-script',
        version: 1,
        steps: [
          { tool: 'tool_a', args: {} },
          { wait: 1_000 },
          { tool: 'tool_b', args: {} },
        ],
      }),
    })
    const first = await collect(adapter.stream(request('', 'wait-cancel')))
    const firstCall = toolCall(first)
    adapter.noteToolResult('wait-cancel', firstCall.id, { isError: false })

    const controller = new AbortController()
    const waiting = collect(adapter.stream({ ...request('', 'wait-cancel'), signal: controller.signal }))
    for (let index = 0; index < 20 && !states.includes('waiting'); index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(states).toContain('waiting')
    controller.abort('user cancelled')

    const chunks = await waiting
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
    expect(adapter.pendingSessionCount).toBe(0)
    expect(adapter.pendingWaitCount).toBe(0)
    expect(states.at(-1)).toBe('cancelled')
  })

  it('keeps a replacement plan alive when a retired result arrives late', async () => {
    const adapter = new MockDebugAdapter()
    adapter.startPlan({
      sessionId: 'replace',
      runId: 'run-old',
      mode: 'run',
      script: validateDebugScript({ type: 'dsh-debug-script', version: 1, steps: [{ tool: 'tool_a', args: {} }] }),
    })
    const oldChunks = await collect(adapter.stream(request('', 'replace')))
    const oldCall = toolCall(oldChunks)
    const oldWaiting = collect(adapter.stream(request('', 'replace')))
    await new Promise(resolve => setTimeout(resolve, 0))

    adapter.startPlan({
      sessionId: 'replace',
      runId: 'run-new',
      mode: 'run',
      script: validateDebugScript({ type: 'dsh-debug-script', version: 1, steps: [{ tool: 'tool_b', args: {} }] }),
    })
    await expect(oldWaiting).resolves.toEqual([{
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'debug request aborted', code: 'ABORTED' } },
    }])

    const newChunks = await collect(adapter.stream(request('', 'replace')))
    const newCall = toolCall(newChunks)
    expect(newCall.name).toBe('tool_b')
    adapter.noteToolResult('replace', oldCall.id, { isError: false })
    expect(adapter.getPlanState('replace')).toMatchObject({ runId: 'run-new', phase: 'running' })
    adapter.noteToolResult('replace', newCall.id, { isError: false })
    await collect(adapter.stream(request('', 'replace')))
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('terminates a cross-session result handoff with DEBUG_PROTOCOL', async () => {
    const adapter = new MockDebugAdapter()
    adapter.startPlan({
      sessionId: 'owner',
      runId: 'run-owner',
      mode: 'run',
      script: validateDebugScript({ type: 'dsh-debug-script', version: 1, steps: [{ tool: 'tool_a', args: {} }] }),
    })
    const ownerChunks = await collect(adapter.stream(request('', 'owner')))
    const ownerCall = toolCall(ownerChunks)
    adapter.noteToolResult('wrong-session', ownerCall.id, { isError: false })

    const terminal = await collect(adapter.stream(request('', 'owner')))
    expect(terminal.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'DEBUG_PROTOCOL' } },
    })
    expect(adapter.pendingSessionCount).toBe(0)
  })

  it('clears pending state on adapter disposal', async () => {
    const adapter = new MockDebugAdapter()
    const chunks = await collect(adapter.stream(request('tool_a({})', 'dispose')))
    expect(toolCall(chunks).id).toMatch(/^debug-/)
    expect(adapter.pendingSessionCount).toBe(1)
    adapter.dispose()
    expect(adapter.pendingSessionCount).toBe(0)
  })
})
