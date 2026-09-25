/** Readonly Team projections rendered through ordinary Mayfly UI nodes. @module dsh-mayfly-agent-team/model */
import type { TeamProjection, TeamTaskView } from '@deepseek-ai/dsh-experimental-agent-team/client';
import { type MayflyUiNode } from '@ephemeral-ai/mayfly-ui';
import type { MayflyTranslate } from '@ephemeral-ai/mayfly/frontend';
/** Live per-member facts overlaid on the roster projection. */
export interface MemberLive {
    readonly loaded: boolean;
    readonly running?: boolean;
    readonly waiting?: boolean;
    readonly model?: string;
    readonly effort?: string;
    readonly activity?: string;
    readonly liveChars?: number;
    readonly tokens?: number;
    readonly toolCount?: number;
}
export declare function taskState(task: TeamTaskView, t: MayflyTranslate): string;
export declare function teamNode(team: TeamProjection | undefined, current: string, live: ReadonlyMap<string, MemberLive>, t: MayflyTranslate): MayflyUiNode;
