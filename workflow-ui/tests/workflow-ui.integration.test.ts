import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

describe('workflow-ui Cordis package contract', () => {
  it('publishes the browser entry and declares the DHS client graph', () => {
    expect(packageJson.exports['./client']).toMatchObject({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(packageJson.dsh.client.platform).toBe('web')
    expect(packageJson.dsh.client.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-workflow-run',
    ]))
  })

  it('registers one dashboard Definition and one dashboard view target', () => {
    const events = { register: vi.fn() }
    const views = { register: vi.fn() }
    const ctx = {
      conversationEvents: events,
      conversationViews: views,
      effect: vi.fn(),
      locale: { register: vi.fn(), bind: vi.fn(() => vi.fn((key: string) => key)) },
      slots: { inject: vi.fn() },
      sessions: { open: vi.fn() },
    } as unknown as ClientContext

    apply(ctx)

    expect(inject).toEqual(['conversationEvents', 'conversationViews', 'slots', 'sessions', 'locale'])
    expect(events.register).toHaveBeenCalledTimes(1)
    expect(views.register).toHaveBeenCalledTimes(1)
    expect((ctx.slots.inject as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])).toEqual([
      'shell.overlay', 'conversation.session.header.actions', 'conversation.view',
    ])
  })
})
