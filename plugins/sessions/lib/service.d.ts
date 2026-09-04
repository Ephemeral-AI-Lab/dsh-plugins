import type { Context } from '@deepseek-ai/cordis';
import type { ListStatusArgs, ListStatusResult } from './types.js';
export declare const LIST_STATUS_DEFAULT_RECENT_N = 50;
export declare class SessionsService {
    private readonly ctx;
    constructor(ctx: Context);
    listStatus(args?: ListStatusArgs, signal?: AbortSignal): Promise<ListStatusResult>;
    private readStatus;
    private readTitles;
}
export declare function validateRecentN(recentN: number | undefined): void;
//# sourceMappingURL=service.d.ts.map