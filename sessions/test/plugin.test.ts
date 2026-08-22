import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

describe('dsh-sessions plugin', () => {
  it('registers session tools, then disposes them', () => {
    const tools: Array<{ name: string }> = []
    const cleanups: Array<() => void> = []
    const ctx = {
      tools: {
        register(definition: { name: string }) {
          tools.push(definition)
          return () => {
            const index = tools.indexOf(definition)
            if (index >= 0) tools.splice(index, 1)
          }
        },
      },
      sessionPersistence: { list: vi.fn(async () => []) },
      agents: { list: vi.fn(() => []) },
      sessionQuery: { readTitleSnapshots: vi.fn(async () => []) },
      effect(body: () => () => void) {
        cleanups.push(body())
        return () => {}
      },
    }

    apply(ctx as never)
    expect(tools.map(tool => tool.name)).toEqual([
      'session_status',
      'session_create',
      'session_send',
    ])

    cleanups[0]!()
    expect(tools).toHaveLength(0)
  })
})
