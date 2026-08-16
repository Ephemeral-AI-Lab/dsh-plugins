import { vi } from 'vitest'
import { apply } from '../../src/index.js'

export type TestEvent = {
  readonly seq: number
  readonly type?: string
  readonly [key: string]: unknown
}

export type RegisteredTool = {
  readonly name: string
  readonly parameters: {
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
  }
  execute(args: unknown, exec: { signal: AbortSignal; agent?: unknown }): Promise<unknown>
}

type Listener = (...args: unknown[]) => void

export function createPluginHarness(initialEvents: readonly TestEvent[] = []) {
  let events = [...initialEvents]
  const registered: RegisteredTool[] = []
  const cleanups: Array<() => void | Promise<void>> = []
  const listeners = new Map<string, Set<Listener>>()

  const persistence = {
    readFrom: vi.fn(async (sessionId: string, fromSeq: number) => ({
      meta: { id: sessionId },
      events: events.filter(event => event.seq >= fromSeq),
    })),
    list: vi.fn(async () => []),
  }

  const agents = {
    create: vi.fn(),
    get: vi.fn(),
    resume: vi.fn(),
    roots: vi.fn(() => []),
  }

  const ctx = {
    tools: {
      register(tool: RegisteredTool) {
        registered.push(tool)
        return () => {
          const index = registered.indexOf(tool)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    agents,
    sessions: {},
    sessionPersistence: persistence,
    effect(body: () => () => void | Promise<void>) {
      cleanups.push(body())
      return () => {}
    },
    on(event: string, listener: Listener) {
      const handlers = listeners.get(event) ?? new Set<Listener>()
      handlers.add(listener)
      listeners.set(event, handlers)
      return () => handlers.delete(listener)
    },
    get(name: string) {
      return (ctx as Record<string, unknown>)[name]
    },
  }

  apply(ctx as never)

  return {
    ctx,
    agents,
    persistence,
    tools: registered,
    tool(name: string): RegisteredTool {
      const tool = registered.find(candidate => candidate.name === name)
      if (tool === undefined) throw new Error(`tool not registered: ${name}`)
      return tool
    },
    setEvents(nextEvents: readonly TestEvent[]) {
      events = [...nextEvents]
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    async dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    },
  }
}

export function runTool(tool: RegisteredTool, args: unknown, agent?: unknown): Promise<unknown> {
  return tool.execute(args, { signal: new AbortController().signal, agent })
}
