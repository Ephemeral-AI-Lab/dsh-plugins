import { readFile, stat } from 'node:fs/promises';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
const MAX_AUTH_BYTES = 1024 * 1024;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
export async function readOAuthFile(authPath, parse, label) {
    let metadata;
    try {
        metadata = await stat(authPath);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    if (!metadata.isFile())
        throw new Error(`${label}: auth cache is not a regular file`);
    if (metadata.size > MAX_AUTH_BYTES)
        throw new Error(`${label}: auth cache is unexpectedly large`);
    return parse(await readFile(authPath, 'utf8'));
}
export async function currentOAuthFile(authPath, parse, update, refresh, label, now = Date.now()) {
    const initial = await readOAuthFile(authPath, parse, label);
    if (initial === undefined || initial.expiresAt > now + REFRESH_SKEW_MS)
        return initial;
    return withFileLock(authPath, async () => {
        const current = await readOAuthFile(authPath, parse, label);
        if (current === undefined || current.expiresAt > now + REFRESH_SKEW_MS)
            return current;
        const refreshed = await refresh(current.credential);
        const next = update(current.document, refreshed, now);
        await writeFileAtomic(authPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 });
        return parse(JSON.stringify(next));
    });
}
//# sourceMappingURL=index.js.map