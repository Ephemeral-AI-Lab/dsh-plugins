import { homedir } from 'node:os';
import { join } from 'node:path';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { currentCodexAuth } from './auth.js';
export const name = 'codex-coding-plan';
export const inject = ['credentials'];
const ACCESS_TOKEN_REF = credentialRef('CODEX_CODING_PLAN_ACCESS_TOKEN');
const SYNC_INTERVAL_MS = 60_000;
export function apply(ctx) {
    const authPath = join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'auth.json');
    const oauth = openaiCodexProvider().auth.oauth;
    if (oauth === undefined)
        throw new Error('codex-coding-plan: installed pi-ai has no OpenAI Codex OAuth support');
    let stopped = false;
    let lastAccess;
    let syncing;
    const sync = async () => {
        if (syncing !== undefined)
            return syncing;
        syncing = (async () => {
            try {
                const auth = await currentCodexAuth(authPath, credential => oauth.refresh(credential, new AbortController().signal));
                if (stopped)
                    return;
                if (auth === undefined) {
                    await ctx.credentials.unset(ACCESS_TOKEN_REF);
                    lastAccess = undefined;
                    return;
                }
                if (auth.accessToken === lastAccess)
                    return;
                await ctx.credentials.set(ACCESS_TOKEN_REF, auth.accessToken);
                lastAccess = auth.accessToken;
            }
            catch (error) {
                if (!stopped) {
                    try {
                        await ctx.credentials.unset(ACCESS_TOKEN_REF);
                        lastAccess = undefined;
                    }
                    catch (cleanupError) {
                        ctx.logger.warn('codex-coding-plan: could not clear its stale DSH access token');
                        ctx.logger.warn(cleanupError);
                    }
                }
                ctx.logger.warn('codex-coding-plan: could not synchronize the existing Codex login');
                ctx.logger.warn(error);
            }
        })().finally(() => { syncing = undefined; });
        return syncing;
    };
    void sync();
    const timer = setInterval(() => { void sync(); }, SYNC_INTERVAL_MS);
    timer.unref();
    ctx.effect(() => async () => {
        stopped = true;
        clearInterval(timer);
        await syncing;
        if (lastAccess !== undefined)
            await ctx.credentials.unset(ACCESS_TOKEN_REF);
    }, 'codex-coding-plan auth synchronization');
}
export { currentCodexAuth, parseCodexAuth, readCodexAuth } from './auth.js';
//# sourceMappingURL=index.js.map