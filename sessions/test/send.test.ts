import { describe, expect, it, vi } from 'vitest'
import { SessionSendService } from '../src/send-service.js'

describe('SessionSendService', () => {
  it('uses steer by default and followup when explicitly requested', async () => {
    const steer = vi.fn()
    const followup = vi.fn()
    const agent = { steer, followup }
    const service = new SessionSendService({
      agents: { get: vi.fn(() => agent) },
      sessionPersistence: {},
    } as never)

    const first = await service.send({ session_id: 'session-live', message: 'steer me' })
    const second = await service.send({ session_id: 'session-live', message: 'follow me', mode: 'followup' })

    expect(first.message_id).toEqual(expect.any(String))
    expect(second.message_id).toEqual(expect.any(String))
    expect(steer).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
    await expect(service.send({
      session_id: 'session-live',
      message: 'invalid mode',
      mode: 'invalid' as never,
    })).rejects.toThrow('mode must be either steer or followup')
  })

  it('uses the default steer mode after resuming a cold session', async () => {
    const steer = vi.fn()
    const followup = vi.fn()
    const handle = { agent: { steer, followup }, dispose: vi.fn(async () => {}) }
    const resume = vi.fn(async () => handle)
    const service = new SessionSendService({
      agents: { get: vi.fn(() => undefined), resume },
      sessionPersistence: {
        inspect: vi.fn(async () => ({ meta: { id: 'session-cold' }, events: [] })),
      },
      get: vi.fn(() => undefined),
    } as never)

    await service.send({ session_id: 'session-cold', message: 'wake it' })

    expect(resume).toHaveBeenCalledWith({ resumeSessionId: 'session-cold' })
    expect(steer).toHaveBeenCalledOnce()
    expect(followup).not.toHaveBeenCalled()
    await service.dispose()
    expect(handle.dispose).toHaveBeenCalledOnce()
  })
})
