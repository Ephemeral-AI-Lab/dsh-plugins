import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import { currentGrokAuth } from './auth.js'

export const name = 'grok-coding-plan'
export const inject = ['credentials']

const ACCESS_TOKEN_REF = credentialRef('GROK_CODING_PLAN_ACCESS_TOKEN')
const SYNC_INTERVAL_MS = 60_000

export function apply(ctx: Context): void {
  const grokHome = process.env['GROK_HOME'] ?? join(homedir(), '.grok')
  const authPath = join(grokHome, 'auth.json')
  const oauth = xaiProvider().auth.oauth
  if (oauth === undefined) throw new Error('grok-coding-plan: installed pi-ai has no xAI OAuth support')
  let stopped = false
  let lastAccess: string | undefined
  let syncing: Promise<void> | undefined

  const sync = async (): Promise<void> => {
    if (syncing !== undefined) return syncing
    syncing = (async () => {
      try {
        const auth = await currentGrokAuth(authPath, credential => oauth.refresh(credential, new AbortController().signal))
        if (stopped) return
        if (auth === undefined) {
          await ctx.credentials.unset(ACCESS_TOKEN_REF)
          lastAccess = undefined
          return
        }
        if (auth.accessToken === lastAccess) return
        await ctx.credentials.set(ACCESS_TOKEN_REF, auth.accessToken)
        lastAccess = auth.accessToken
      } catch (error) {
        if (!stopped) {
          try {
            await ctx.credentials.unset(ACCESS_TOKEN_REF)
            lastAccess = undefined
          } catch (cleanupError) {
            ctx.logger.warn('grok-coding-plan: could not clear its stale DSH access token')
            ctx.logger.warn(cleanupError)
          }
        }
        ctx.logger.warn('grok-coding-plan: could not synchronize the existing Grok login')
        ctx.logger.warn(error)
      }
    })().finally(() => { syncing = undefined })
    return syncing
  }

  void sync()
  const timer = setInterval(() => { void sync() }, SYNC_INTERVAL_MS)
  timer.unref()
  ctx.effect(() => async () => {
    stopped = true
    clearInterval(timer)
    await syncing
    if (lastAccess !== undefined) await ctx.credentials.unset(ACCESS_TOKEN_REF)
  }, 'grok-coding-plan auth synchronization')
}

export { currentGrokAuth, parseGrokAuth, readGrokAuth } from './auth.js'
