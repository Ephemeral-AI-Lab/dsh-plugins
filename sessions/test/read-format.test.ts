import { describe, expect, it } from 'vitest'
import { formatReadSessionOutput } from '../src/read-format.js'
import type { ReadSessionMessage } from '../src/types.js'

const userMessage = {
  id: 'message-1',
  role: 'user',
  content: [{ type: 'text', text: 'hello' }],
  source: { kind: 'user' },
} as ReadSessionMessage

const assistantMessage = {
  id: 'message-2',
  role: 'assistant',
  content: [{ type: 'tool-call', id: 'call-1', name: 'read_session', arguments: '{"session_id":"other"}' }],
  source: { kind: 'model', provider: 'mock', model: 'mock' },
} as ReadSessionMessage

describe('read_session output', () => {
  it('renders reconstructed message blocks without XML or event lines', () => {
    const output = formatReadSessionOutput({
      session_id: 'session-1',
      offset: 2,
      messages: [
        userMessage,
        assistantMessage,
      ],
      total_messages: 4,
    })

    expect(output).toContain('Session session-1')
    expect(output).toContain('[USER]\nhello')
    expect(output).toContain('[ASSISTANT]\nTool call: read_session')
    expect(output).toContain('(Showing messages 2-3 of 4)')
    expect(output).not.toContain('<path>')
    expect(output).not.toContain('<content>')
    expect(output).not.toContain('text-delta')
    expect(output).not.toContain('assistant/chunk')
    expect(output).not.toContain('Use offset=')
  })

  it('prints the total message count at the end of the session', () => {
    expect(formatReadSessionOutput({
      session_id: 'empty',
      offset: 1,
      messages: [],
      total_messages: 0,
    })).toContain('(End of session - total 0 messages)')
  })
})
