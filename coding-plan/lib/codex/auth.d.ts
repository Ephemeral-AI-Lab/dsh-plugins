import type { OAuthCredential } from '@earendil-works/pi-ai';
import { type LoadedOAuthFile } from 'dsh-coding-plan/core';
interface CodexAuthDocument {
    auth_mode: 'chatgpt';
    tokens: {
        access_token: string;
        refresh_token: string;
        account_id: string;
        id_token?: string;
    };
    last_refresh?: string;
    [key: string]: unknown;
}
export type LoadedCodexAuth = LoadedOAuthFile<CodexAuthDocument>;
export type RefreshOAuth = (credential: OAuthCredential) => Promise<OAuthCredential>;
export declare function parseCodexAuth(raw: string): LoadedCodexAuth;
export declare function readCodexAuth(authPath: string): Promise<LoadedCodexAuth | undefined>;
export declare function currentCodexAuth(authPath: string, refresh: RefreshOAuth, now?: number): Promise<LoadedCodexAuth | undefined>;
export {};
//# sourceMappingURL=auth.d.ts.map