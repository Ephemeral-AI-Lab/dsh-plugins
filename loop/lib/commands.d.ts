import type { Context } from '@deepseek-ai/cordis';
export type LoopCommand = {
    name: 'loop_create';
    arguments: {
        prompt: string;
        time_in_seconds: number;
    };
} | {
    name: 'loop_list';
    arguments: Record<string, never>;
} | {
    name: 'loop_delete';
    arguments: {
        id: string;
    };
};
export declare function registerLoopCommand(rootCtx: Context, commandCtx: Context): () => void;
export declare function parseLoopCommand(rawInput: string): LoopCommand | undefined;
//# sourceMappingURL=commands.d.ts.map