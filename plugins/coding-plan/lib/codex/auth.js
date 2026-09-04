import { Buffer } from 'node:buffer';
import { currentOAuthFile, readOAuthFile, } from 'dsh-coding-plan/core';
function object(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function requiredString(value, field) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`codex-coding-plan: Codex auth cache is missing ${field}`);
    }
    return value;
}
function jwtExpiry(token) {
    const payload = token.split('.')[1];
    if (payload === undefined)
        throw new Error('codex-coding-plan: Codex access token is not a JWT');
    let decoded;
    try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    }
    catch {
        throw new Error('codex-coding-plan: Codex access token has an invalid JWT payload');
    }
    const exp = object(decoded)?.['exp'];
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) {
        throw new Error('codex-coding-plan: Codex access token has no valid expiry');
    }
    return exp * 1000;
}
export function parseCodexAuth(raw) {
    let decoded;
    try {
        decoded = JSON.parse(raw);
    }
    catch {
        throw new Error('codex-coding-plan: Codex auth cache is not valid JSON');
    }
    const root = object(decoded);
    if (root?.['auth_mode'] !== 'chatgpt') {
        throw new Error('codex-coding-plan: Codex is not signed in with ChatGPT');
    }
    const tokens = object(root['tokens']);
    if (tokens === undefined)
        throw new Error('codex-coding-plan: Codex auth cache has no tokens');
    const accessToken = requiredString(tokens['access_token'], 'tokens.access_token');
    const refresh = requiredString(tokens['refresh_token'], 'tokens.refresh_token');
    const accountId = requiredString(tokens['account_id'], 'tokens.account_id');
    const expiresAt = jwtExpiry(accessToken);
    return {
        accessToken,
        expiresAt,
        credential: { type: 'oauth', access: accessToken, refresh, expires: expiresAt, accountId },
        document: decoded,
    };
}
export function readCodexAuth(authPath) {
    return readOAuthFile(authPath, parseCodexAuth, 'codex-coding-plan: Codex');
}
export function currentCodexAuth(authPath, refresh, now = Date.now()) {
    return currentOAuthFile(authPath, parseCodexAuth, (document, refreshed, timestamp) => {
        const accessToken = requiredString(refreshed.access, 'refreshed access token');
        const refreshToken = requiredString(refreshed.refresh, 'refreshed refresh token');
        const accountId = requiredString(refreshed['accountId'], 'refreshed account ID');
        return {
            ...document,
            tokens: {
                ...document.tokens,
                access_token: accessToken,
                refresh_token: refreshToken,
                account_id: accountId,
            },
            last_refresh: new Date(timestamp).toISOString(),
        };
    }, refresh, 'codex-coding-plan: Codex', now);
}
//# sourceMappingURL=auth.js.map