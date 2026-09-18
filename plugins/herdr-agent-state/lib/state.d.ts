/**
 * Pure models for the pane's Herdr reports: the semantic agent state, the
 * session display facts (title, model, context), and the small formatting
 * helpers they share.
 *
 * @module herdr-agent-state/state
 */
/**
 * Compact token count like the dsh TUI's status bar: `988`, `3.4k`, `12k`,
 * `1.0M`. Negative values clamp to zero.
 * @param count - the raw token count.
 * @returns the compact display string.
 */
export declare function formatTokens(count: number): string;
/** The token-usage fields this integration reads from `assistant/message`. */
export interface UsageTokens {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
/**
 * Context occupancy from one `assistant/message` usage payload. The counts are
 * disjoint, so occupancy is the uncached input plus both cache fields.
 * `inputTokens` is the anchor: a sample without it carries no meaning.
 * @param usage - the usage payload, when one was reported.
 * @returns the occupancy in tokens, or undefined when the sample carries none.
 */
export declare function sumUsageTokens(usage: UsageTokens | undefined): number | undefined;
/**
 * The `used/window` context display, mirroring the dsh TUI status bar
 * (`34k/1.0M`). Bare `used` when the window is unknown; nothing before the
 * first usage sample.
 * @param used - occupied context tokens.
 * @param contextWindow - the route's advertised context window, when known.
 * @returns the display string, or undefined before the first usage sample.
 */
export declare function formatContextUsage(used: number | undefined, contextWindow: number | undefined): string | undefined;
/**
 * Keep only the five known state-label keys with non-blank text, trimmed.
 * @param labels - configured labels keyed by Herdr state.
 * @returns the wire payload, or undefined when nothing survives.
 */
export declare function stateLabelsPayload(labels: Record<string, string> | undefined): Record<string, string> | undefined;
/** The pane's semantic agent state as Herdr understands it. */
export type PaneState = 'working' | 'blocked' | 'idle';
/** One pane state report: the state plus an optional human label. */
export interface PaneStateReport {
    state: PaneState;
    message?: string;
}
/**
 * Pure semantic state model for the pane's Herdr state.
 */
export declare class AgentStateModel {
    /** Agent objects reported as `running`, by identity (stable per session). */
    private readonly runningAgents;
    /** Number of open approval/question interactions. */
    private blockedCount;
    /** Label of the most recently opened blocked interaction. */
    private blockedMessage;
    /** Tool calls that survived approval and are still running, by call id. */
    private readonly tools;
    /**
     * Record one agent's running state; pass the same agent object on later events.
     * @param agent - the agent whose status changed.
     * @param running - whether it entered `running`.
     */
    setRunning(agent: unknown, running: boolean): void;
    /**
     * Open or close one blocked interaction. `active: true` opens a pending
     * approval/question and records `message`; `active: false` closes the most
     * recent one (never below zero).
     * @param active - whether an interaction opened (true) or settled (false).
     * @param message - the interaction's human label, when opening.
     */
    setBlocked(active: boolean, message?: string): void;
    /**
     * A tool call survived approval and is about to run (`tools/execute`).
     * @param callId - the tool call's id.
     * @param name - the tool's display name.
     */
    toolStarted(callId: string, name: string): void;
    /**
     * The call settled (`tools/result`, or the execute waterfall's finally).
     * Idempotent; an unknown call id is a no-op.
     * @param callId - the finished tool call's id.
     */
    toolFinished(callId: string): void;
    /** The most recently started still-active tool name, or undefined. */
    private currentTool;
    /**
     * The report derived from the current inputs. A blocked interaction labels
     * itself; a working pane labels itself with the current tool, when one is
     * active.
     * @returns the state report to publish.
     */
    desired(): PaneStateReport;
}
/** Display facts a session may already carry when it starts. */
export interface SessionFacts {
    title?: string | undefined;
    model?: string | undefined;
    contextWindow?: number | undefined;
    usedTokens?: number | undefined;
}
/** One publishable metadata patch: a changed title and/or token keys. */
export interface FactsPatch {
    title?: string;
    tokens?: Record<string, string | null>;
}
/** The envelope shape {@link SessionFactsModel.observeEvent} folds. */
export interface ObservedEvent {
    type: string;
    data?: unknown;
}
/**
 * Tracks which session's display facts are current — title, model, context
 * window, context occupancy — and decides, from session-start seeds and the
 * session-log feed, what changed enough to publish.
 */
export declare class SessionFactsModel {
    /** Session identity from the latest agent/session-start. */
    private sessionId;
    /** Latest applicable title for that session. */
    private title;
    /** Latest model id from request/header config. */
    private model;
    /** Advertised context window in tokens, when known. */
    private contextWindow;
    /** Context occupancy from the latest assistant/message usage sample. */
    private usedTokens;
    /** Last title this model published (change tracking; resets per session). */
    private lastReportedTitle;
    /**
     * Last tokens snapshot this model published against (present-only). Kept
     * across sessions so a key that becomes unknown is null-cleared rather
     * than left stale on the pane.
     */
    private lastReportedTokens;
    /**
     * The tracked session changed (agent/session-start). Adopts the new identity
     * and any pre-existing facts — a resumed session's log predates the plugin.
     * Title change tracking resets so an identical title re-publishes; token
     * tracking persists so stale keys are null-cleared.
     * @param sessionId - the new session's identity, when one exists.
     * @param initial - pre-existing facts seeded from the session log.
     * @returns the publishable patch, when anything changed.
     */
    setSession(sessionId: string | undefined, initial?: SessionFacts): FactsPatch | undefined;
    /**
     * Fold one session/event feed observation for the tracked session. Handles
     * `session/title`, `request/header`, `request/context`, and
     * `assistant/message`; other types and other sessions are ignored, and the
     * first observed session is adopted when none was recorded (plugin reloaded
     * mid-session). A usage-less assistant/message keeps the last occupancy.
     * @param sessionId - the session the event belongs to.
     * @param event - the logged event envelope.
     * @returns the publishable patch, when anything changed.
     */
    observeEvent(sessionId: string | undefined, event: ObservedEvent): FactsPatch | undefined;
    /** The publishable title, when it is a non-blank string. */
    desiredTitle(): string | undefined;
    /** The publishable tokens snapshot, present-only. */
    desiredTokens(): Record<string, string>;
    /**
     * Consume the changed facts once, tracking them as reported. Token payloads
     * are key-level patches: a fresh value is sent as-is, a key that became
     * unknown after being reported is sent as null (explicit clear), and a key
     * never reported is omitted.
     * @returns the publishable patch, when anything changed.
     */
    private takePublishable;
}
//# sourceMappingURL=state.d.ts.map