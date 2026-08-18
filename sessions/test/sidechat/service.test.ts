import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../../src/sidechat/sidechat-service.js'

describe('side-chat service', () => {
  it('starts a fork continuable child and continues it through the Harness child id', async () => {
    const startContinuable = vi.fn(async () => ({ childId: 'child-1', messageId: 'message-1' }))
    const followup = vi.fn(async () => 'message-2')
    const service = new SideChatService({ subagents: { startContinuable, followup } } as never)
    const parent = {} as never
    const signal = new AbortController().signal

    await expect(service.open({ prompt: 'inspect the build' }, parent, signal)).resolves.toEqual({
      subagent_id: 'child-1',
      message_id: 'message-1',
      accepted: true,
      status: 'running',
    })
    await expect(service.send('child-1', 'continue the review', parent, signal)).resolves.toEqual({ message_id: 'message-2' })

    expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'fork',
      surface: 'side-chat',
      label: 'inspect the build',
      request: expect.objectContaining({ prompt: [{ type: 'text', text: 'inspect the build' }] }),
    }))
    expect(followup).toHaveBeenCalledWith(parent, 'child-1', [{ type: 'text', text: 'continue the review' }], expect.objectContaining({ source: { kind: 'user' } }))
  })

  it('rejects an empty opening prompt before touching the Harness', async () => {
    const startContinuable = vi.fn()
    const service = new SideChatService({ subagents: { startContinuable } } as never)

    await expect(service.open({ prompt: '   ' }, {} as never, new AbortController().signal)).rejects.toThrow('prompt must be a non-empty string')
    expect(startContinuable).not.toHaveBeenCalled()
  })
})
