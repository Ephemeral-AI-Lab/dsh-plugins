import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

describe('dsh-sessions plugin', () => {
  it('registers session tools and /sessions, then disposes both', () => {
    const tools: Array<{ name: string }> = []
    const commands: Array<{ name: string }> = []
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
      commands: {
        register(definition: { name: string }) {
          commands.push(definition)
          return () => {
            const index = commands.indexOf(definition)
            if (index >= 0) commands.splice(index, 1)
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
      'list_sessions',
      'read_session',
      'check_session_status',
      'create_session',
    ])
    expect(commands.map(command => command.name)).toEqual(['sessions'])

    cleanups[0]!()
    expect(tools).toHaveLength(0)
    expect(commands).toHaveLength(0)
  })
})
