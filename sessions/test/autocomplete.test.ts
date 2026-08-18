import { describe, expect, it } from 'vitest'
import { appendReadOption, previewForDraft } from '../src/ui/autocomplete.js'

describe('sessions composer autocomplete', () => {
  it('keeps the session picker open after the command-space', () => {
    expect(previewForDraft('/sessions read ')).toEqual({ kind: 'read' })
  })

  it('treats zero, one, or multiple spaces between command words alike', () => {
    expect(previewForDraft('/sessionslist')).toBeUndefined()
    expect(previewForDraft('/sessions  list')).toBeUndefined()
    expect(previewForDraft('  /sessions    status   ')).toEqual({ kind: 'status' })
    expect(previewForDraft('/sessions   read   session-123')).toMatchObject({
      kind: 'read-options',
      sessionId: 'session-123',
    })
  })

  it('offers read options after a session id', () => {
    expect(previewForDraft('/sessions read session-123')).toEqual({
      kind: 'read-options',
      sessionId: 'session-123',
      options: [
        { flag: '--offset', description: 'Start at a 1-based message offset.' },
        { flag: '--limit', description: 'Limit the number of message blocks.' },
      ],
    })
  })

  it('removes a used option and filters a partially typed option', () => {
    expect(previewForDraft('/sessions read session-123 --offset 3 --l')).toEqual({
      kind: 'read-options',
      sessionId: 'session-123',
      options: [{ flag: '--limit', description: 'Limit the number of message blocks.' }],
    })
  })

  it('closes when there are no remaining options', () => {
    expect(previewForDraft('/sessions read session-123 --offset 1 --limit 5')).toBeUndefined()
  })

  it('inserts an option with a space for its numeric value', () => {
    expect(appendReadOption('/sessions read session-123', '--offset'))
      .toBe('/sessions read session-123 --offset ')
    expect(appendReadOption('/sessions read session-123 --of', '--offset'))
      .toBe('/sessions read session-123 --offset ')
  })
})
