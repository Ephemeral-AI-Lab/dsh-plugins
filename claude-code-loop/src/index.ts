import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { LoopRuntime } from './loop.js'
import { registerLoopCommand } from './commands.js'
import { registerLoopTools } from './tools.js'
import { loopProjectionDefinition } from './projection.js'

export const name = 'claude-code-loop'
export const inject = ['tools', 'commands', 'agents', 'sessions', 'sessionPersistence', 'sessionProjections']

// dsh-session exposes no public external event registration API; register the
// plugin-owned durable event in the installed runtime catalog for persistence.
;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add('loop/change')

type OwnerCleanup = () => void | Promise<void>

export function apply(ctx: Context): void {
  ctx.sessionProjections.register(loopProjectionDefinition as never)
  const runtimes = new Map<Agent, OwnerCleanup>()
  let stopping = false

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      const attachedAgent = agent
      if (stopping || runtimes.has(attachedAgent) || !ctx.agents.roots().includes(attachedAgent)) return

      const runtime = new LoopRuntime({ ctx, agent: attachedAgent })
      const cleanup = attachedAgent.ctx.effect(() => {
        const disposeTools = registerLoopTools(ctx, attachedAgent.ctx, attachedAgent, runtime)
        const disposeCommand = registerLoopCommand(ctx, attachedAgent.ctx, attachedAgent)
        runtime.start()
        return async () => {
          disposeCommand()
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
