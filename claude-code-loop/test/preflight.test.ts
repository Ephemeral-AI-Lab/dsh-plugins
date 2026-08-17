import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { inject, name } from '../src/index.js'

describe('claude-code-loop preflight', () => {
  it('declares the host plugin contract without browser dependencies', () => {
    expect(name).toBe('claude-code-loop')
    expect(inject).toEqual(['tools', 'commands', 'agents', 'sessions', 'sessionPersistence', 'sessionProjections'])
    expect(KNOWN_SESSION_EVENT_TYPES.has('loop/change')).toBe(true)
  })
})
