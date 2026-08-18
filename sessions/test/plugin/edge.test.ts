import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src/index.js'
import * as flatTools from '../../src/tools.js'
import * as toolIndex from '../../src/tools/index.js'
import { registerSessionsCommand } from '../../src/commands.js'
import { SessionCreationService } from '../../src/creation-service.js'
import { SessionSendService } from '../../src/send-service.js'
import { SessionsService } from '../../src/service.js'
import { registerSessionTools } from '../../src/tools/index.js'

type Registration = {
  name?: string
  description?: string
  input?: { hint?: string }
  execute?: unknown
  handler?: unknown
  [key: string]: unknown
}

function makeHarness() {
  const tools: Registration[] = []
  const commands: Registration[] = []
  const effects: Array<() => Promise<void>> = []
  const events: string[] = []
  const ctx = {
    tools: {
      register(definition: Registration) {
        tools.push(definition)
        events.push(`register-tool:${definition.name}`)
        return () => {
          events.push(`dispose-tool:${definition.name}`)
          const index = tools.indexOf(definition)
          if (index >= 0) tools.splice(index, 1)
        }
      },
    },
    commands: {
      register(definition: Registration) {
        commands.push(definition)
        events.push(`register-command:${definition.name}`)
        return () => {
          events.push(`dispose-command:${definition.name}`)
          const index = commands.indexOf(definition)
          if (index >= 0) commands.splice(index, 1)
        }
      },
    },
    sessionPersistence: {
      list: vi.fn(async () => []),
      inspect: vi.fn(async () => ({ meta: { id: 'session-test' }, events: [] })),
    },
    agents: {
      list: vi.fn(() => []),
      get: vi.fn(() => undefined),
    },
    sessionQuery: { readTitleSnapshots: vi.fn(async () => []) },
    effect(body: () => () => Promise<void>, label: string) {
      events.push(`effect:${label}`)
      effects.push(body())
      return () => {}
    },
    get: vi.fn(() => undefined),
  }
  return { ctx, tools, commands, effects, events }
}

async function applyAndCleanup(harness = makeHarness()) {
  plugin.apply(harness.ctx as never)
  const cleanup = harness.effects.at(-1)
  if (cleanup !== undefined) await cleanup()
  return harness
}

function serviceSet(ctx: ReturnType<typeof makeHarness>['ctx']) {
  return {
    service: new SessionsService(ctx as never),
    creation: new SessionCreationService(ctx as never),
    sending: new SessionSendService(ctx as never),
  }
}

describe('dsh-sessions plugin wiring edge cases', () => {
  const easyCases = [
    ['exports the expected plugin name', () => expect(plugin.name).toBe('dsh-sessions')],
    ['injects tools', () => expect(plugin.inject).toContain('tools')],
    ['injects commands', () => expect(plugin.inject).toContain('commands')],
    ['injects agents', () => expect(plugin.inject).toContain('agents')],
    ['injects llm', () => expect(plugin.inject).toContain('llm')],
    ['injects session persistence', () => expect(plugin.inject).toContain('sessionPersistence')],
    ['injects session query', () => expect(plugin.inject).toContain('sessionQuery')],
    ['injects workspace registry', () => expect(plugin.inject).toContain('workspaceRegistry')],
    ['exports apply as a function', () => expect(plugin.apply).toBeTypeOf('function')],
    ['registers four current tool names', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools.map(tool => tool.name)).toEqual(['session_status', 'session_read', 'session_create', 'session_send'])
    }],
    ['does not register the old create name', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools.map(tool => tool.name)).not.toContain('create_session')
    }],
    ['does not register the old list name', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools.map(tool => tool.name)).not.toContain('list_status')
    }],
    ['does not register the old read name', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools.map(tool => tool.name)).not.toContain('read_session')
    }],
    ['does not register the old send name', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools.map(tool => tool.name)).not.toContain('send_session')
    }],
    ['registers one slash command', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands.map(command => command.name)).toEqual(['sessions'])
    }],
    ['describes the slash command', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands[0]?.description).toContain('session')
    }],
    ['advertises status syntax', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands[0]?.input?.hint).toContain('status')
    }],
    ['advertises read syntax', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands[0]?.input?.hint).toContain('read')
    }],
    ['advertises create syntax', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands[0]?.input?.hint).toContain('create')
    }],
    ['advertises send syntax', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands[0]?.input?.hint).toContain('send')
    }],
    ['registers the cleanup effect', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.effects).toHaveLength(1)
    }],
    ['labels the cleanup effect', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.events).toContain('effect:dsh-sessions cleanup')
    }],
    ['registers tools before the command', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.events.findIndex(event => event.startsWith('register-tool'))).toBeLessThan(h.events.findIndex(event => event === 'register-command:sessions'))
    }],
    ['returns without a public value', () => {
      const h = makeHarness()
      expect(plugin.apply(h.ctx as never)).toBeUndefined()
    }],
    ['keeps all tools before cleanup', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools).toHaveLength(4)
    }],
    ['keeps the command before cleanup', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.commands).toHaveLength(1)
    }],
    ['removes tools on cleanup', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!()
      expect(h.tools).toHaveLength(0)
    }],
    ['removes the command on cleanup', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!()
      expect(h.commands).toHaveLength(0)
    }],
    ['cleanup can be called twice', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!(); await h.effects[0]!()
      expect(h.tools).toHaveLength(0)
    }],
    ['separate contexts own separate registrations', () => {
      const first = makeHarness(); const second = makeHarness()
      plugin.apply(first.ctx as never); plugin.apply(second.ctx as never)
      expect(first.tools).not.toBe(second.tools)
      expect(first.tools).toHaveLength(4)
      expect(second.tools).toHaveLength(4)
    }],
  ] as const

  it.each(easyCases)('EASY — %s', async (_name, check) => { await check() })

  const mediumCases = [
    ['registerSessionTools can omit optional services', () => {
      const h = makeHarness(); const { service } = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, service)
      expect(h.tools.map(tool => tool.name)).toEqual(['session_status', 'session_read']); dispose()
    }],
    ['registerSessionTools registers all four services', () => {
      const h = makeHarness(); const set = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, set.service, set.creation, set.sending)
      expect(h.tools).toHaveLength(4); dispose()
    }],
    ['tool disposer removes registrations in reverse order', () => {
      const h = makeHarness(); const set = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, set.service, set.creation, set.sending); dispose()
      expect(h.events.slice(-4)).toEqual(['dispose-tool:session_send', 'dispose-tool:session_create', 'dispose-tool:session_read', 'dispose-tool:session_status'])
    }],
    ['status registration exposes execute', () => {
      const h = makeHarness(); const { service } = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, service)
      expect(h.tools[0]?.execute).toBeTypeOf('function'); dispose()
    }],
    ['read registration exposes execute', () => {
      const h = makeHarness(); const { service } = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, service)
      expect(h.tools[1]?.execute).toBeTypeOf('function'); dispose()
    }],
    ['create registration exposes execute', () => {
      const h = makeHarness(); const set = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, set.service, set.creation)
      expect(h.tools[2]?.execute).toBeTypeOf('function'); dispose()
    }],
    ['send registration exposes execute', () => {
      const h = makeHarness(); const set = serviceSet(h.ctx)
      const dispose = registerSessionTools(h.ctx as never, set.service, set.creation, set.sending)
      expect(h.tools[3]?.execute).toBeTypeOf('function'); dispose()
    }],
    ['command registration exposes a handler', () => {
      const h = makeHarness(); const { service } = serviceSet(h.ctx)
      const dispose = registerSessionsCommand(h.ctx as never, service)
      expect(h.commands[0]?.handler).toBeTypeOf('function'); dispose()
    }],
    ['command registration includes recordInput false', () => {
      const h = makeHarness(); const { service } = serviceSet(h.ctx)
      const dispose = registerSessionsCommand(h.ctx as never, service)
      expect(h.commands[0]?.recordInput).toBe(false); dispose()
    }],
    ['command registration returns a disposer', () => {
      const h = makeHarness(); const { service } = serviceSet(h.ctx)
      const dispose = registerSessionsCommand(h.ctx as never, service)
      expect(dispose).toBeTypeOf('function'); dispose()
    }],
    ['flat tools barrel forwards the registrar', () => {
      expect(flatTools.registerSessionTools).toBe(toolIndex.registerSessionTools)
    }],
    ['flat tools barrel forwards the create export', () => {
      expect(flatTools.registerSessionCreateTool).toBe(toolIndex.registerSessionCreateTool)
    }],
    ['flat tools barrel forwards the status export', () => {
      expect(flatTools.registerSessionStatusTool).toBe(toolIndex.registerSessionStatusTool)
    }],
    ['flat tools barrel forwards the read export', () => {
      expect(flatTools.registerSessionReadTool).toBe(toolIndex.registerSessionReadTool)
    }],
    ['flat tools barrel forwards the send export', () => {
      expect(flatTools.registerSessionSendTool).toBe(toolIndex.registerSessionSendTool)
    }],
    ['index registrar alias is preserved', () => {
      expect(plugin.registerSessionsTool).toBe(plugin.registerSessionTools)
    }],
    ['plugin exposes the creation service class', () => {
      expect(plugin.SessionCreationService).toBe(SessionCreationService)
    }],
    ['plugin exposes the send service class', () => {
      expect(plugin.SessionSendService).toBe(SessionSendService)
    }],
    ['plugin exposes the sessions service class', () => {
      expect(plugin.SessionsService).toBe(SessionsService)
    }],
    ['plugin cleanup leaves no registration events pending', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!()
      expect(h.tools).toEqual([]); expect(h.commands).toEqual([])
    }],
  ] as const

  it.each(mediumCases)('MEDIUM — %s', async (_name, check) => { await check() })

  const hardCases = [
    ['cleanup is safe after a partial external removal', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      h.tools.shift(); await h.effects[0]!()
      expect(h.tools).toHaveLength(0); expect(h.commands).toHaveLength(0)
    }],
    ['two cleanup calls leave disposal state consistent', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!(); await h.effects[0]!()
      expect(h.events.filter(event => event.startsWith('dispose-tool'))).toHaveLength(8)
      expect(h.tools).toHaveLength(0)
    }],
    ['one context cleanup does not affect another context', async () => {
      const first = makeHarness(); const second = makeHarness()
      plugin.apply(first.ctx as never); plugin.apply(second.ctx as never); await first.effects[0]!()
      expect(first.tools).toHaveLength(0); expect(second.tools).toHaveLength(4)
    }],
    ['reapplying after cleanup restores the full registration set', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!(); plugin.apply(h.ctx as never)
      expect(h.tools.map(tool => tool.name)).toEqual(['session_status', 'session_read', 'session_create', 'session_send'])
    }],
    ['direct registrar disposal is independent from command disposal', () => {
      const h = makeHarness(); const set = serviceSet(h.ctx)
      const disposeTools = registerSessionTools(h.ctx as never, set.service, set.creation, set.sending)
      const disposeCommand = registerSessionsCommand(h.ctx as never, set.service)
      disposeTools()
      expect(h.tools).toHaveLength(0); expect(h.commands).toHaveLength(1); disposeCommand()
    }],
    ['the command remains callable after direct tool disposal', async () => {
      const h = makeHarness(); const set = serviceSet(h.ctx)
      const disposeTools = registerSessionTools(h.ctx as never, set.service, set.creation, set.sending)
      const disposeCommand = registerSessionsCommand(h.ctx as never, set.service); disposeTools()
      const result = await (h.commands[0]!.handler as Function)({ agent: undefined, rawInput: 'status', signal: undefined })
      expect(result).toEqual({ kind: 'success', text: 'No sessions found.' }); disposeCommand()
    }],
    ['all current tool definitions have unique names', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(new Set(h.tools.map(tool => tool.name)).size).toBe(h.tools.length)
    }],
    ['all current tool definitions have executable functions', () => {
      const h = makeHarness(); plugin.apply(h.ctx as never)
      expect(h.tools.every(tool => typeof tool.execute === 'function')).toBe(true)
    }],
    ['cleanup records command disposal before tool disposal', async () => {
      const h = makeHarness(); plugin.apply(h.ctx as never); await h.effects[0]!()
      expect(h.events.at(-5)).toBe('dispose-command:sessions')
    }],
    ['plugin exports both canonical and compatibility tool registrars', () => {
      expect(plugin.registerSessionTools).toBe(plugin.registerSessionsTool)
      expect(flatTools.registerSessionTools).toBe(flatTools.registerSessionsTool)
    }],
  ] as const

  it.each(hardCases)('HARD — %s', async (_name, check) => { await check() })
})
