import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPluginHarness, runTool } from './support/plugin.js'

describe('codex-session-communication registration', () => {
  const harnesses: Array<ReturnType<typeof createPluginHarness>> = []

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.dispose()
  })

  it('registers exactly the five specified tools', () => {
    const harness = createPluginHarness()
    harnesses.push(harness)

    expect(harness.tools.map(tool => tool.name).sort()).toEqual([
      'create_session',
      'list_sessions',
      'read_session',
      'send_message_to_session',
      'wait_sessions',
    ])
  })

  it('exposes the v1 schemas without request_id or runtime options', () => {
    const harness = createPluginHarness()
    harnesses.push(harness)

    expect(harness.tool('create_session').parameters).toMatchObject({
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
    })
    expect(harness.tool('send_message_to_session').parameters).toMatchObject({
      properties: {
        session_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['session_id', 'message'],
    })
    expect(harness.tool('wait_sessions').parameters).toMatchObject({
      properties: {
        session_ids: { type: 'array' },
        after: { type: 'object' },
        timeout_ms: { type: 'number' },
      },
      required: ['session_ids'],
    })
    expect(harness.tool('read_session').parameters).toMatchObject({
      properties: {
        session_id: { type: 'string' },
        after_seq: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['session_id'],
    })
    expect(harness.tool('list_sessions').parameters).toMatchObject({
      properties: { limit: { type: 'number' } },
    })

    for (const tool of harness.tools) {
      expect(tool.parameters.properties).not.toHaveProperty('request_id')
      expect(tool.parameters.properties).not.toHaveProperty('model')
      expect(tool.parameters.properties).not.toHaveProperty('agent_options')
    }
  })

  it('rejects missing and empty required values before doing session work', async () => {
    const harness = createPluginHarness()
    harnesses.push(harness)

    await expect(runTool(harness.tool('create_session'), {})).rejects.toThrow()
    await expect(runTool(harness.tool('create_session'), { prompt: '   ' })).rejects.toThrow()
    await expect(runTool(harness.tool('send_message_to_session'), {
      session_id: '',
      message: 'hello',
    })).rejects.toThrow()
    await expect(runTool(harness.tool('send_message_to_session'), {
      session_id: 'session-1',
      message: '   ',
    })).rejects.toThrow()
    await expect(runTool(harness.tool('wait_sessions'), { session_ids: [] })).rejects.toThrow()
    await expect(runTool(harness.tool('wait_sessions'), {
      session_ids: ['session-1'],
      timeout_ms: -1,
    })).rejects.toThrow()
    await expect(runTool(harness.tool('read_session'), {
      session_id: 'session-1',
      limit: 0,
    })).rejects.toThrow()
  })

  it('inherits the caller route and preset when creating a child session', async () => {
    const harness = createPluginHarness()
    harnesses.push(harness)
    const handle = {
      agent: { followup: vi.fn() },
      dispose: vi.fn(async () => {}),
    }
    harness.agents.create.mockResolvedValue(handle)
    const parent = {
      options: { provider: 'mock-provider', model: 'mock-model' },
      session: { header: { cwd: '/tmp/test-workspace' } },
      ctx: {
        agents: harness.agents,
        get: vi.fn(() => undefined),
      },
    }

    await runTool(harness.tool('create_session'), { prompt: 'hello child' }, parent)

    expect(harness.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: { cwd: '/tmp/test-workspace' },
      agentOptions: parent.options,
      setup: expect.any(Function),
    }))
    expect(handle.agent.followup).toHaveBeenCalledTimes(1)
  })
})
