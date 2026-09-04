import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  CallId,
} from '@deepseek-ai/dsh-llm'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly executed: string[]
}

async function createHarness(id: string): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'Integration test persona.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  apply(ctx)

  const executed: string[] = []
  ctx.tools.register(defineTool({
    name: 'probe_tool',
    description: 'Record one required string value.',
    parameters: {
      value: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          value: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `PROBE_RESULT:${value.value}` }],
    },
    async execute(args) {
      executed.push(args.value)
      return { ok: true, value: args.value }
    },
  }))

  return {
    ctx,
    agent: ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' }),
    executed,
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

describe('mock through the real DSH loop and tool runtime', () => {
  it('executes a real registered tool and records call, result, and final response', async () => {
    const harness = await createHarness('valid')
    try {
      const idle = waitForIdle(harness.ctx, harness.agent)
      send(harness.agent, 'probe_tool({"value":"ok"})')
      await idle

      expect(harness.executed).toEqual(['ok'])
      const events = harness.agent.session.events
      expect(events.some(event => event.type === 'tool/call' && event.data.name === 'probe_tool')).toBe(true)
      const result = events.find(event => event.type === 'tool/result')
      expect(result?.data.message.source.callId).toEqual(expect.any(String))
      expect(result?.data.message.content[0]).toMatchObject({ isError: false })
      const final = events.filter(event => event.type === 'assistant/message').at(-1)
      expect(final).toBeDefined()
      expect(final?.data.message.content.some(block => block.type === 'text'
        && block.text.includes('Mock run completed (1 executable step).'))).toBe(true)
      expect(final?.data.message.content.some(block => block.type === 'text'
        && block.text.includes('PROBE_RESULT:ok'))).toBe(false)
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('preserves UNKNOWN_TOOL from the real runtime', async () => {
    const harness = await createHarness('unknown')
    try {
      const idle = waitForIdle(harness.ctx, harness.agent)
      send(harness.agent, 'does_not_exist({})')
      await idle

      expect(harness.executed).toEqual([])
      const result = harness.agent.session.events.find(event => event.type === 'tool/result')
      expect(result?.data.error).toMatchObject({ code: 'UNKNOWN_TOOL' })
      expect(result?.data.message.source.callId).toEqual(expect.any(String))
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('preserves INVALID_ARGS from the real runtime', async () => {
    const harness = await createHarness('invalid-args')
    try {
      const idle = waitForIdle(harness.ctx, harness.agent)
      send(harness.agent, 'probe_tool({})')
      await idle

      expect(harness.executed).toEqual([])
      const result = harness.agent.session.events.find(event => event.type === 'tool/result')
      expect(result?.data.error).toMatchObject({ code: 'INVALID_ARGS' })
      expect(result?.data.message.source.callId).not.toEqual(CallId(''))
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

})
