import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { KNOWN_SESSION_EVENT_TYPES as SessionEventTypes } from '@deepseek-ai/dsh-session'
import { LoopRuntime } from './loop.js'
import { registerLoopCommand } from './commands.js'
import { registerLoopTools } from './tools.js'
import { loopProjectionDefinition } from './projection.js'

export const name = 'claude-code-loop'
export const inject = ['tools', 'commands', 'agents', 'sessions', 'sessionPersistence', 'sessionProjections']

// Resolve from the running DSH entry point so linked plugins mutate the host's
// event catalog rather than a duplicate dependency under the plugin checkout.
const sessionModulePath = createRequire(pathToFileURL(process.argv[1]!)).resolve('@deepseek-ai/dsh-session')
const { KNOWN_SESSION_EVENT_TYPES } = await import(pathToFileURL(sessionModulePath).href) as {
  KNOWN_SESSION_EVENT_TYPES: typeof SessionEventTypes
}
;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add('loop/change')

type OwnerCleanup = () => void | Promise<void>

export function apply(ctx: Context): void {
  ctx.sessionProjections.register(loopProjectionDefinition as never)
  registerLoopCommand(ctx, ctx)
  const runtimes = new Map<Agent, OwnerCleanup>()
  let stopping = false

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      const attachedAgent = agent
      if (stopping || runtimes.has(attachedAgent) || !ctx.agents.roots().includes(attachedAgent)) return

      const runtime = new LoopRuntime({ ctx, agent: attachedAgent })
      const cleanup = attachedAgent.ctx.effect(() => {
        const disposeTools = registerLoopTools(ctx, attachedAgent.ctx, attachedAgent, runtime)
        runtime.start()
        return async () => {
          disposeTools()
          try {
            await runtime.dispose()
          } finally {
            if (runtimes.get(attachedAgent) === cleanup) runtimes.delete(attachedAgent)
          }
        }
      }, 'claude-code-loop.runtime()')
      runtimes.set(attachedAgent, cleanup)
    })

    return async () => {
      stopping = true
      stopCreated()
      const cleanups = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
    }
  }, 'claude-code-loop.lifecycle()')
}

export { LoopRuntime } from './loop.js'
export { registerLoopCommand } from './commands.js'
export { registerLoopTools } from './tools.js'
export * from './types.js'
