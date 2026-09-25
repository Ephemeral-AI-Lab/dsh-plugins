/** Optional Team composition; UI follows the presence of Mayfly services. @module dsh-mayfly-agent-team */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "mayfly-agent-team";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;
