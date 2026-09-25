/**
 * Herdr integration for any dsh frontend: pane state reporter plus optional
 * orchestration surface.
 *
 * A Cordis function plugin that, when loaded inside a Herdr pane, reports the
 * pane's semantic state (working / blocked / idle, labeled with the current
 * tool while working), session reference and log path, and session display
 * facts — title, model, and context usage as pane metadata — to Herdr's pane
 * socket. When the profile mounts the skills service it can also contribute
 * Herdr's own `SKILL.md` (preferring `herdr --skill` so the body matches the
 * installed binary) plus a sibling-session addendum, and when it mounts the
 * tools service it can register `herdr_agent_*` orchestration tools. It
 * depends only on documented dsh extension points — agent lifecycle events,
 * the approval / user-question / tool-dispatch waterfalls, and the session-log
 * event feed — so it works in TUI, web, and headless profiles alike. Outside
 * a Herdr pane it is a strict no-op.
 *
 * @module dsh-herdr-plus
 */
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions';
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * Ask composed answerers for structured user input. Return an answer to
         * claim the request or call `next()` to delegate. Declared here because the
         * linked dev artifact's emitted types can predate the event's declaration
         * in `dsh-user-questions/src/types.ts`; keep the signature in sync with it.
         * @param request - pending user-question request.
         * @mode waterfall
         */
        'user-questions/request'(request: {
            questions: AskUserQuestionItem[];
        }, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer>;
    }
}
export declare const name = "dsh-herdr-plus";
/** The plugin consumes no injected services; it reads the environment and events only. */
export declare const inject: string[];
/** Display text per Herdr state; non-blank entries become pane state labels. */
export type StateLabels = {
    idle: string;
    working: string;
    blocked: string;
    done: string;
    unknown: string;
};
/** Plugin configuration; every field has a schema default. */
export interface Config {
    /**
     * Herdr agent label reported for the pane. A host frontend sets its own name
     * (e.g. `blue`) by overriding this field in a patch overlay.
     */
    agent: string;
    /**
     * Stable, unique integration source. Keep it constant so Herdr attributes the
     * pane's lifecycle authority to this reporter and so a second reporter can
     * coexist under a different source.
     */
    source: string;
    /**
     * Transport to Herdr. `socket` speaks the pane socket directly; `cli` is a
     * declared-but-unimplemented fallback and is rejected at load.
     */
    transport: 'socket' | 'cli';
    /** Report the pane's session reference so Herdr can expose it for restore. */
    reportSession: boolean;
    /**
     * Which title to publish as the Herdr pane title (display-only metadata).
     * `session` mirrors the dsh session title — first-prompt fallback,
     * LLM-generated, or pinned by `/rename`; `none` disables title reporting.
     */
    title: 'session' | 'none';
    /** Whether to attach a human label to blocked reports. */
    message: 'tool' | 'none';
    /** Whether to attach the currently-executing tool name to working reports. */
    workingMessage: 'tool' | 'none';
    /**
     * Report the model id (`model`) and context usage (`ctx`, `used/window`
     * mirroring the dsh TUI status bar) as Herdr Agent-sidebar tokens.
     */
    tokens: 'auto' | 'none';
    /**
     * Display text per Herdr state; non-blank entries become pane state labels
     * (e.g. `{ working: 工作中, blocked: 等待确认 }`). All-blank disables them.
     */
    stateLabels: StateLabels;
    /**
     * `auto` registers the `herdr_agent_*` orchestration tools when the profile
     * mounts the tools service; `none` keeps the plugin report-only.
     */
    tools: 'auto' | 'none';
    /**
     * `auto` contributes the `herdr` skill when the profile mounts the skills
     * service, preferring the installed binary's `herdr --skill` output;
     * `bundled` serves only the vendored copy (no subprocess); `none`
     * contributes nothing.
     */
    skill: 'auto' | 'bundled' | 'none';
    /**
     * Command line `herdr_agent_spawn` runs in the sibling pane; the task is
     * appended as one shell-quoted argv word (e.g. `mayfly`, or
     * `dsh --profile mayfly`).
     */
    launchCommand: string;
    /** Kill-switch for coexisting with another reporter in the same tree. */
    enabled: boolean;
}
/** Schemastery configuration for the plugin. */
export declare const Config: z<Config>;
/**
 * Drive one pane's reporter from the live dsh event stream.
 * @param ctx - the plugin's host context.
 * @param config - the resolved plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map