import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import {
  compileDebugScript,
  parseDebugCommand,
  validateDebugScript,
} from '../src/index.js'
import { apply } from '../src/index.js'
import { readReplayInput } from '../src/replay-input.js'

class RecordingRealAdapter extends LlmAdapter {
  readonly requests: string[] = []
  readonly configs: GenerateOptions[] = []

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'Recording real provider' }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.configs.push(options)
    this.requests.push(options.messages.at(-1)?.content.map(block => block.type === 'text' ? block.text : block.type).join('') ?? '')
    const text = 'REAL_PROVIDER_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise(resolve => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('debug-agent command and scheduling contract', () => {
  it('rejects direct ZIP replay with an explicit extraction diagnostic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-debug-archive-'))
    const archivePath = join(directory, 'session.zip')
    try {
      await writeFile(archivePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      await expect(readReplayInput(archivePath)).rejects.toMatchObject({
        code: 'UNSUPPORTED_ARCHIVE',
        path: archivePath,
      })
      await expect(readReplayInput(archivePath)).rejects.toThrow(/extract session\.jsonl/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(!existsSync('C:\\Users\\yifan\\Downloads\\dsh-session-session-bada1bd3-0a37-417b-bbdf-2c9b5844967f.zip'))('rejects the referenced session ZIP without UTF-8 parsing', async () => {
    const archivePath = 'C:\\Users\\yifan\\Downloads\\dsh-session-session-bada1bd3-0a37-417b-bbdf-2c9b5844967f.zip'
    await expect(readReplayInput(archivePath)).rejects.toMatchObject({ code: 'UNSUPPORTED_ARCHIVE', path: archivePath })
  })

  it('accepts only one run unit and compiles executable progress correctly', () => {
    expect(parseDebugCommand('/debug run a({"x":[1,true,null]})')).toEqual({
      kind: 'run',
      calls: [{ name: 'a', arguments: { x: [1, true, null] } }],
    })
    expect(parseDebugCommand('/debug run [a({}) b({"v":2})]').calls).toHaveLength(2)
    expect(() => parseDebugCommand('/debug run a({}); b({})')).toThrow()
    expect(() => parseDebugCommand('/debug run wait(250)')).toThrow()
    expect(() => parseDebugCommand('/debug run a({}) --wait 10')).toThrow()

    const script = validateDebugScript({
      type: 'dsh-debug-script',
      version: 1,
      steps: [
        { tool: 'a', args: {} },
        { wait: 250 },
        { parallel: [{ tool: 'b', args: {} }, { tool: 'c', args: {} }] },
        { tool: 'd', args: {} },
      ],
    })
    expect(compileDebugScript(script).steps.map(step => step.waitBefore)).toEqual([0, 250, 100])
    expect(compileDebugScript(script, 50).steps.map(step => step.waitBefore)).toEqual([0, 50, 100])
    expect(() => validateDebugScript({ type: 'dsh-debug-script', version: 1, steps: [{ wait: 1 }, { tool: 'a', args: {} }] })).toThrow()
    expect(() => validateDebugScript({ type: 'dsh-debug-script', version: 1, steps: [{ tool: 'a', args: {} }, { wait: 1 }, { wait: 2 }, { tool: 'b', args: {} }] })).toThrow()
  })

  it('routes slash debug through the real ToolRuntime, then restores the real provider', async () => {
    const ctx = new Context()
    const real = new RecordingRealAdapter()
    const executed: string[] = []
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: 'contract test' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['recording-real'], real)
    ctx.on('agent/request', async (_payload, next) => ({ ...(await next()), temperature: 0.2, stop: ['END'] }))
    apply(ctx)
    ctx.tools.register(defineTool({
      name: 'probe_tool',
      description: 'Record a value.',
      parameters: { value: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, value: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `RESULT:${value.value}` }],
      },
      async execute(args) {
        executed.push(args.value)
        return { ok: true, value: args.value }
      },
    }))
    const agent = ctx.agentLoop.create(SessionId('slash-contract'), { provider: 'recording-real', model: 'real', maxTokens: 321 })
    try {
      const debugIdle = waitForIdle(ctx, agent)
      const command = await ctx.commands.execute(
        agent,
        '/debug run probe_tool({"value":"debug"})',
        new AbortController().signal,
      )
      expect(command?.result).toEqual({ kind: 'success', text: 'Debug command queued.' })
      await debugIdle
      expect(executed).toEqual(['debug'])
      expect(agent.options.provider).toBe('recording-real')
      expect(agent.session.events.some(event => event.type === 'assistant/message' && event.data.message.source.provider === 'mock-debug')).toBe(true)
      const debugFinal = agent.session.events.filter(event => event.type === 'assistant/message').at(-1)
      expect(debugFinal?.data.message.content.some(block => block.type === 'text'
        && block.text.includes('Debug run completed (1 executable step).'))).toBe(true)
      expect(debugFinal?.data.message.content.some(block => block.type === 'text'
        && block.text.includes('RESULT:debug'))).toBe(false)

      const realIdle = waitForIdle(ctx, agent)
      send(agent, 'ordinary real-provider message')
      await realIdle
      expect(real.requests.at(-1)).toContain('ordinary real-provider message')
      expect(real.requests.at(-1)).not.toContain('mock-debug')
      expect(real.configs.at(-1)).toMatchObject({
        provider: 'recording-real',
        model: 'real',
        temperature: 0.2,
        maxTokens: 321,
        stop: ['END'],
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels a real tool execution, clears replay state, and restores the real route', async () => {
    const ctx = new Context()
    const real = new RecordingRealAdapter()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: 'cancellation contract test' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['recording-real'], real)
    apply(ctx)

    let entered = false
    let aborted = false
    ctx.tools.register(defineTool({
      name: 'slow_probe',
      description: 'Wait for cancellation.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: 'SLOW_RESULT' }],
      },
      async execute(_args, execution) {
        entered = true
        return await new Promise<{ ok: true }>(resolve => {
          const finish = (): void => {
            aborted = true
            resolve({ ok: true })
          }
          if (execution.signal.aborted) finish()
          else execution.signal.addEventListener('abort', finish, { once: true })
        })
      },
    }))

    const agent = ctx.agentLoop.create(SessionId('cancel-contract'), { provider: 'recording-real', model: 'real' })
    try {
      const firstIdle = waitForIdle(ctx, agent)
      send(agent, '/debug run slow_probe({})')
      for (let index = 0; index < 100 && !entered; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      expect(entered).toBe(true)
      agent.cancel({ kind: 'user' })
      await firstIdle
      await agent.whenIdle()
      expect(aborted).toBe(true)
      expect(agent.session.events.findLast(event => event.type === 'debug/status')?.data).toMatchObject({
        phase: 'cancelled',
        errorCode: 'CANCELLED',
      })
      expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason).toMatchObject({ kind: 'aborted' })

      const realIdle = waitForIdle(ctx, agent)
      send(agent, 'ordinary message after cancellation')
      await realIdle
      expect(real.requests.at(-1)).toContain('ordinary message after cancellation')
      expect(real.requests.at(-1)).not.toContain('mock-debug')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('replays canonical JSON in memory with an implicit gap and leaves the source unchanged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-debug-agent-'))
    const sourcePath = join(directory, 'script.json')
    const source = JSON.stringify({
      type: 'dsh-debug-script',
      version: 1,
      steps: [
        { tool: 'probe_tool', args: { value: 'one' } },
        { tool: 'probe_tool', args: { value: 'two' } },
      ],
    })
    await writeFile(sourcePath, source, 'utf8')

    const ctx = new Context()
    const executed: string[] = []
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: 'replay contract test' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    apply(ctx)
    ctx.tools.register(defineTool({
      name: 'probe_tool',
      description: 'Record a value.',
      parameters: { value: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, value: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `RESULT:${value.value}` }],
      },
      async execute(args) {
        executed.push(args.value)
        return { ok: true, value: args.value }
      },
    }))
    const agent = ctx.agentLoop.create(SessionId('replay-contract'), { provider: 'mock-debug', model: 'debug' })
    try {
      const idle = waitForIdle(ctx, agent)
      send(agent, `/debug replay "${sourcePath}" --overwrite-wait-time-ms 0`)
      await idle
      expect(executed).toEqual(['one', 'two'])
      expect(await readFile(sourcePath, 'utf8')).toBe(source)
      expect(agent.session.events.filter(event => event.type === 'tool/call')).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
