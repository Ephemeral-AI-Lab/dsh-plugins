import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SideChatRuntime } from './service.js'

export const name = 'sidechat'
export const inject = [
  'llm',
  'sessions',
  'sessionPersistence',
  'agents',
  'agentDefaultModel',
  'connection',
]

export function apply(ctx: Context): void {
  const runtime = new SideChatRuntime(ctx)
  ctx.connection.rpc.handle('/sidechat', async (endpoint, payload, signal) => ({
    ok: true,
    value: await runtime.handle(endpoint, payload, signal),
  }), { authority: 'loopback' })
  ctx.effect(() => () => { runtime.dispose() }, 'sidechat.runtime()')
}

export { SideChatRuntime, SIDECHAT_SYSTEM_PROMPT } from './service.js'
export { requestRoute, sideChatKind, stableMessages } from './context.js'
export type * from './types.js'
