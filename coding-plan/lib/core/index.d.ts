import type { OAuthCredential } from '@earendil-works/pi-ai';
export interface LoadedOAuthFile<T> {
    accessToken: string;
    expiresAt: number;
    credential: OAuthCredential;
    document: T;
}
export type ParseOAuthFile<T> = (raw: string) => LoadedOAuthFile<T>;
export type UpdateOAuthFile<T> = (document: T, refreshed: OAuthCredential, now: number) => T;
export type RefreshOAuth = (credential: OAuthCredential) => Promise<OAuthCredential>;
export declare function readOAuthFile<T>(authPath: string, parse: ParseOAuthFile<T>, label: string): Promise<LoadedOAuthFile<T> | undefined>;
export declare function currentOAuthFile<T>(authPath: string, parse: ParseOAuthFile<T>, update: UpdateOAuthFile<T>, refresh: RefreshOAuth, label: string, now?: number): Promise<LoadedOAuthFile<T> | undefined>;
//# sourceMappingURL=index.d.ts.map