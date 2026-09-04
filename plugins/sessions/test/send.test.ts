import { describe, expect, it, vi } from 'vitest'
import { SessionSendService } from '../src/send-service.js'

describe('SessionSendService', () => {
  it('uses steer by default and followup when explicitly requested', async () => {
    const steer = vi.fn()
    const followup = vi.fn()
    const service = new SessionSendService({
      agents: { get: vi.fn(() => ({ steer, followup })) },
      sessionPersistence: {},
    } as never)

    const first = await service.send({ session_id: 'session-live', message: 'steer me' })
    const second = await service.send({ session_id: 'session-live', message: 'follow me', mode: 'followup' })

    expect(first.message_id).toEqual(expect.any(String))
    expect(second.message_id).toEqual(expect.any(String))
    expect(steer).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
  })

  it('resumes a cold session and disposes its owned handle', async () => {
    const steer = vi.fn()
    const handle = { agent: { steer, followup: vi.fn() }, dispose: vi.fn(async () => {}) }
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
    await service.dispose()
    expect(handle.dispose).toHaveBeenCalledOnce()
  })
})
