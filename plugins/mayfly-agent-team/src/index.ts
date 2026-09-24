/** Optional Team composition; UI follows the presence of Mayfly services. @module dsh-mayfly-agent-team */
import type { Context } from '@deepseek-ai/cordis'
import * as runtime from './runtime.ts'

export const name = 'mayfly-agent-team'
export const inject = runtime.inject

export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(runtime)
  ctx.inject(['mayflyCurrentAgent', 'mayflyLocale', 'mayflyOverlays', 'mayflyStatus', 'mayflyEditorExtensions'], async owner => {
    await owner.plugin(await import('./tui.ts'))
  })
}
