/** Readonly Team projections rendered through ordinary Mayfly UI nodes. @module dsh-mayfly-agent-team/model */
import type { TeamProjection, TeamTaskView } from '@deepseek-ai/dsh-experimental-agent-team/client';
import { type MayflyUiNode } from '@ephemeral-ai/mayfly-ui';
import type { MayflyTranslate } from '@ephemeral-ai/mayfly/frontend';
export interface MemberActivity {
    readonly running: boolean;
    readonly model?: string;
}
export declare function taskState(task: TeamTaskView, t: MayflyTranslate): string;
export declare function teamNode(team: TeamProjection | undefined, current: string, activity: ReadonlyMap<string, MemberActivity>, t: MayflyTranslate): MayflyUiNode;
export declare function taskNode(task: TeamTaskView, ownerAvailable: boolean, t: MayflyTranslate): MayflyUiNode;
