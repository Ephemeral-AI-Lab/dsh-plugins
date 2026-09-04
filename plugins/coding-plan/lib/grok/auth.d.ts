import type { OAuthCredential } from '@earendil-works/pi-ai';
import { type LoadedOAuthFile } from 'dsh-coding-plan/core';
interface GrokAuthDocument {
    [provider: string]: unknown;
}
export type LoadedGrokAuth = LoadedOAuthFile<GrokAuthDocument>;
export type RefreshOAuth = (credential: OAuthCredential) => Promise<OAuthCredential>;
export declare function parseGrokAuth(raw: string): LoadedGrokAuth;
export declare function readGrokAuth(authPath: string): Promise<LoadedGrokAuth | undefined>;
export declare function currentGrokAuth(authPath: string, refresh: RefreshOAuth, now?: number): Promise<LoadedGrokAuth | undefined>;
export {};
//# sourceMappingURL=auth.d.ts.map