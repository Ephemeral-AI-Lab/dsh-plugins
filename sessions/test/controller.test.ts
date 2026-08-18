import { describe, expect, it } from 'vitest'
import { SessionsPopupController } from '../src/ui/controller.js'

describe('SessionsPopupController', () => {
  it('keeps session_read output as a content popup', () => {
    const controller = new SessionsPopupController()
    controller.show({
      kind: 'success',
      text: 'Session session-1\n[USER]\nhello\n\n(End of session - total 1 messages)',
    })

    expect(controller.state.getSnapshot()).toEqual({
      open: true,
      kind: 'read',
      sessionId: 'session-1',
      content: '[USER]\nhello\n\n(End of session - total 1 messages)',
    })
  })
})
