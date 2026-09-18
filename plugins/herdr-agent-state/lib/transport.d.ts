/**
 * Herdr pane socket transport and reporter.
 *
 * Mirrors Herdr's own bundled Pi integration wire contract: one newline-delimited
 * JSON request per `pane.report_agent` / `pane.report_agent_session` /
 * `pane.release_agent` call — plus display-only `pane.report_metadata` for the
 * pane title, tokens, and state labels — a fresh single connection per request,
 * a short timeout plus one longer retry, and a failure that never rejects into
 * the host process (Herdr being absent must not disturb the dsh frontend).
 *
 * Only `node:net` is used.
 * @module herdr-agent-state/transport
 */
import type { PaneStateReport } from './state.js';
/** The environment slice this transport reads (Herdr pane variables). */
export type HerdrEnv = Record<string, string | undefined>;
/** True when the process runs inside a Herdr pane that can receive reports. */
export declare function herdrEnabled(env: HerdrEnv): boolean;
/** Resolve the socket endpoint, mapping Windows named pipes as Herdr does. */
export declare function socketEndpoint(env: HerdrEnv): string;
/** One newline-delimited JSON request on the Herdr pane socket. */
export interface WireRequest {
    id: string;
    method: string;
    params: Record<string, unknown>;
}
/**
 * Deliver one request over a fresh single connection. A pane report is
 * fire-and-forget, so delivery means the request was written to Herdr's socket
 * (the write flushed), not that Herdr replied — Herdr's pane socket does not
 * necessarily acknowledge. Resolves `true` once the write flushes, `false` on
 * any failure. Never throws.
 *
 * @param request - the request line to write.
 * @param endpoint - the socket endpoint from {@link socketEndpoint}.
 * @param timeoutMs - first-attempt write deadline.
 * @param retryMs - retry write deadline after a failed first attempt.
 * @returns whether the request flushed to the socket.
 */
export declare function sendRequest(request: WireRequest, endpoint: string, timeoutMs?: number, retryMs?: number): Promise<boolean>;
/** Construction options for {@link HerdrReporter}. */
export interface HerdrReporterOptions {
    source: string;
    agent: string;
    reportSession: boolean;
    reportTitle?: boolean;
    reportTokens?: boolean;
    env: HerdrEnv;
}
/** Display-only metadata kinds accepted on `pane.report_metadata`. */
export interface MetadataFields {
    title?: string | undefined;
    tokens?: Record<string, string | null> | undefined;
    state_labels?: Record<string, string> | undefined;
}
/**
 * Owns the seq counter, the single-flight latest-wins state queue, the session
 * reference, and the transport. Calling `publishState` coalesces bursts: only
 * the newest state is sent, and only when it differs from the last sent one.
 * Metadata (`reportMetadata`) is per-kind deduped and sent directly, like the
 * session report: these values change rarely and never need burst coalescing.
 */
export declare class HerdrReporter {
    private readonly source;
    private readonly agent;
    private readonly reportSessionRef;
    private readonly reportTitleRef;
    private readonly reportTokensRef;
    private readonly endpoint;
    private readonly paneId;
    private seq;
    private sessionId;
    private sessionPath;
    private sendInFlight;
    private queued;
    private lastSent;
    private lastSentTitle;
    private lastSentTokens;
    private lastSentStateLabels;
    /** Token keys ever sent, so release() can clear exactly those. */
    private readonly sentTokenKeys;
    constructor(options: HerdrReporterOptions);
    /** Record the session reference to attach to subsequent reports. */
    setSessionId(id: string | undefined): void;
    /** Record the session log path (jsonl backends) to attach to session reports. */
    setSessionPath(path: string | undefined): void;
    private nextSeq;
    private sessionParams;
    private send;
    /** Report the current pane state, coalescing bursts to a single latest value. */
    publishState(report: PaneStateReport, force?: boolean): void;
    /**
     * Report display-only Herdr pane metadata. Title and state labels are
     * presentation fields and carry the `agent` / `applies_to_source` guards, so
     * they display exactly while this reporter holds the pane's lifecycle
     * authority; tokens always apply and are this reporter's to clear. One
     * combined request carries whichever kinds changed; nothing is sent when
     * nothing did.
     *
     * @param fields - the metadata patch; omitted kinds are left untouched.
     */
    reportMetadata(fields?: MetadataFields): void;
    /** Report the pane's session reference; Herdr exposes it for restore. */
    reportSession(sessionStartSource: string | undefined): void;
    /**
     * Release this pane's lifecycle authority (on unload or process exit). The
     * guards on presentation metadata are checked when a report arrives, not
     * continuously, so every metadata kind this reporter sent is cleared
     * explicitly alongside the release.
     */
    release(): void;
    private drain;
}
//# sourceMappingURL=transport.d.ts.map