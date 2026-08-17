import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/ui/index.js'

describe('client plugin entry', () => {
  it('registers the session-scoped loop dock and routes commands through the host', async () => {
    const execute = vi.fn(async () => ({ ok: true, value: { commandId: 'cmd-1', result: { kind: 'success', text: 'ok' } } }))
    const register = vi.fn()
    const injectSlot = vi.fn((name: string, factory: () => unknown) => {
      expect(name).toBe('conversation.input.dock')
      factory()
    })
    const ctx = {
      slots: { inject: injectSlot, register },
      remote: { commands: { execute } },
    } as never

    apply(ctx)

    expect(inject).toEqual(['slots', 'remote', 'remote.commands'])
    expect(register).toHaveBeenCalledOnce()
    const definition = register.mock.calls[0]?.[0]
    expect(definition).toMatchObject({ name: 'conversation.input.dock', id: 'loops', order: 30 })
    await definition.inject('session-1').execute('/loop list')
    expect(execute).toHaveBeenCalledWith('session-1', '/loop list')
  })
})
