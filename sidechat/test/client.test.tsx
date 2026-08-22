import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { SideChatPanel } from '../src/client/SideChatPanel.js'
import { SideChatClient, SideChatStore } from '../src/client/store.js'

afterEach(cleanup)

describe('SideChatPanel', () => {
  it('opens against the centered session and submits follow-up and steer input', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    let running = false
    const rpc: ClientConnectionRpc = {
      async call(_channel, endpoint, payload) {
        calls.push({ endpoint, payload })
        const value = endpoint === 'open'
          ? {
              sideChatId: '00000000-0000-4000-8000-000000000001',
              capability: 'x'.repeat(43),
              anchor: {
                sessionId: 'child-session', kind: 'subagent', title: 'Greeting helper',
                capturedAt: 1, capturedThroughSeq: 10, inheritedMessages: 4,
                provider: 'provider', model: 'model',
              },
            }
          : endpoint === 'submit'
            ? (running = true, { messageId: 'message-1', accepted: true })
            : endpoint === 'snapshot'
              ? {
                  status: running ? 'running' : 'idle', messages: [], queuedCount: 0,
                  anchor: {
                    sessionId: 'child-session', kind: 'subagent', title: 'Greeting helper',
                    capturedAt: 1, capturedThroughSeq: 10, inheritedMessages: 4,
                    provider: 'provider', model: 'model',
                  },
                }
              : { accepted: true }
        return { ok: true, value: { ok: true, value } }
      },
    }
    const store = new SideChatStore(new SideChatClient(rpc))
    const list = {
      current: 'child-session',
      ids: ['child-session'],
      byId: { 'child-session': { displayTitle: 'Greeting helper' } },
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    }
    const sessions = {
      list: { getSnapshot: () => list, subscribe: () => () => {} },
    }

    render(<SideChatPanel store={store} sessions={sessions as never} close={vi.fn()} />)
    await screen.findByText('Read-only context')
    expect(calls[0]).toMatchObject({
      endpoint: 'open', payload: { anchorSessionId: 'child-session', anchorTitle: 'Greeting helper' },
    })

    const input = screen.getByLabelText('Message side chat')
    fireEvent.change(input, { target: { value: 'first question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Queue follow-up' })).toBeTruthy())

    fireEvent.change(input, { target: { value: 'focus elsewhere' } })
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
    await waitFor(() => expect(calls.filter(call => call.endpoint === 'submit')).toHaveLength(2))
    expect(calls.filter(call => call.endpoint === 'submit').at(-1)?.payload)
      .toMatchObject({ delivery: 'steer' })
  })
})
