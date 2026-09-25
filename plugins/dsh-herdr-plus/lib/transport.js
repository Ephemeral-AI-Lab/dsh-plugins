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
 * @module dsh-herdr-plus/transport
 */
import net from 'node:net';
/** True when the process runs inside a Herdr pane that can receive reports. */
export function herdrEnabled(env) {
    return env.HERDR_ENV === '1' && Boolean(env.HERDR_SOCKET_PATH) && Boolean(env.HERDR_PANE_ID);
}
/** Resolve the socket endpoint, mapping Windows named pipes as Herdr does. */
export function socketEndpoint(env) {
    const raw = env.HERDR_SOCKET_PATH ?? '';
    return process.platform === 'win32' && raw !== '' ? `\\\\.\\pipe\\${raw}` : raw;
}
/** Shallow, undefined-tolerant equality for the small metadata payloads. */
function shallowEqual(a, b) {
    if (a === b)
        return true;
    if (a === undefined || b === undefined)
        return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if (a[key] !== b[key])
            return false;
    }
    return true;
}
/** A fresh per-request id that stays unique across bursts. */
function requestId(prefix) {
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
export function sendRequest(request, endpoint, timeoutMs = 500, retryMs = 1500) {
    return new Promise((resolve) => {
        const attempt = (delay, onSettled) => {
            let finished = false;
            let timer;
            const finish = (delivered) => {
                if (finished)
                    return;
                finished = true;
                if (timer !== undefined)
                    clearTimeout(timer);
                client.destroy();
                onSettled(delivered);
            };
            const client = net.createConnection(endpoint);
            client.on('error', () => finish(false));
            client.on('end', () => finish(false));
            client.on('connect', () => {
                client.write(`${JSON.stringify(request)}\n`, () => finish(true));
            });
            timer = setTimeout(() => finish(false), delay);
            timer.unref();
        };
        attempt(timeoutMs, (delivered) => {
            if (delivered)
                resolve(true);
            else
                attempt(retryMs, (retried) => resolve(retried));
        });
    });
}
/**
 * Owns the seq counter, the single-flight latest-wins state queue, the session
 * reference, and the transport. Calling `publishState` coalesces bursts: only
 * the newest state is sent, and only when it differs from the last sent one.
 * Metadata (`reportMetadata`) is per-kind deduped and sent directly, like the
 * session report: these values change rarely and never need burst coalescing.
 */
export class HerdrReporter {
    source;
    agent;
    reportSessionRef;
    reportTitleRef;
    reportTokensRef;
    endpoint;
    paneId;
    seq;
    sessionId;
    sessionPath;
    sendInFlight = false;
    queued;
    lastSent;
    lastSentTitle;
    lastSentTokens;
    lastSentStateLabels;
    /** Token keys ever sent, so release() can clear exactly those. */
    sentTokenKeys = new Set();
    constructor(options) {
        this.source = options.source;
        this.agent = options.agent;
        this.reportSessionRef = options.reportSession;
        this.reportTitleRef = options.reportTitle ?? false;
        this.reportTokensRef = options.reportTokens ?? false;
        this.endpoint = socketEndpoint(options.env);
        this.paneId = options.env.HERDR_PANE_ID ?? '';
        // Wall-clock base keeps seq strictly increasing across process restarts.
        this.seq = Date.now() * 1000;
    }
    /** Record the session reference to attach to subsequent reports. */
    setSessionId(id) {
        this.sessionId = id;
    }
    /** Record the session log path (jsonl backends) to attach to session reports. */
    setSessionPath(path) {
        this.sessionPath = typeof path === 'string' && path !== '' ? path : undefined;
    }
    nextSeq() {
        this.seq += 1;
        return this.seq;
    }
    sessionParams() {
        if (this.reportSessionRef && this.sessionId !== undefined && this.sessionId !== '') {
            return {
                agent_session_id: this.sessionId,
                ...(this.sessionPath !== undefined ? { agent_session_path: this.sessionPath } : {}),
            };
        }
        return {};
    }
    send(request) {
        return sendRequest(request, this.endpoint);
    }
    /** Report the current pane state, coalescing bursts to a single latest value. */
    publishState(report, force = false) {
        if (!force && report.state === this.lastSent?.state && report.message === this.lastSent?.message) {
            return;
        }
        if (!force)
            this.lastSent = report;
        this.queued = { ...report, seq: this.nextSeq() };
        void this.drain();
    }
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
    reportMetadata(fields = {}) {
        const params = { pane_id: this.paneId, source: this.source };
        let guarded = false;
        if (this.reportTitleRef &&
            typeof fields.title === 'string' &&
            fields.title.trim() !== '' &&
            fields.title !== this.lastSentTitle) {
            this.lastSentTitle = fields.title;
            params.title = fields.title;
            guarded = true;
        }
        if (fields.state_labels !== undefined &&
            Object.keys(fields.state_labels).length > 0 &&
            !shallowEqual(fields.state_labels, this.lastSentStateLabels)) {
            this.lastSentStateLabels = { ...fields.state_labels };
            params.state_labels = { ...fields.state_labels };
            guarded = true;
        }
        if (this.reportTokensRef &&
            fields.tokens !== undefined &&
            Object.keys(fields.tokens).length > 0 &&
            !shallowEqual(fields.tokens, this.lastSentTokens)) {
            this.lastSentTokens = { ...fields.tokens };
            params.tokens = { ...fields.tokens };
            for (const key of Object.keys(fields.tokens))
                this.sentTokenKeys.add(key);
        }
        if (params.title === undefined && params.state_labels === undefined && params.tokens === undefined)
            return;
        if (guarded) {
            params.agent = this.agent;
            params.applies_to_source = this.source;
        }
        params.seq = this.nextSeq();
        void this.send({
            id: requestId(`${this.source}:meta`),
            method: 'pane.report_metadata',
            params,
        });
    }
    /** Report the pane's session reference; Herdr exposes it for restore. */
    reportSession(sessionStartSource) {
        const params = this.sessionParams();
        if (Object.keys(params).length === 0)
            return;
        void this.send({
            id: requestId(`${this.source}:session`),
            method: 'pane.report_agent_session',
            params: {
                pane_id: this.paneId,
                source: this.source,
                agent: this.agent,
                seq: this.nextSeq(),
                ...(sessionStartSource !== undefined ? { session_start_source: sessionStartSource } : {}),
                ...params,
            },
        });
    }
    /**
     * Release this pane's lifecycle authority (on unload or process exit). The
     * guards on presentation metadata are checked when a report arrives, not
     * continuously, so every metadata kind this reporter sent is cleared
     * explicitly alongside the release.
     */
    release() {
        const clear = {};
        if (this.reportTitleRef && this.lastSentTitle !== undefined)
            clear.clear_title = true;
        if (this.lastSentStateLabels !== undefined)
            clear.clear_state_labels = true;
        if (this.reportTokensRef && this.sentTokenKeys.size > 0) {
            const tokens = {};
            for (const key of this.sentTokenKeys)
                tokens[key] = null;
            clear.tokens = tokens;
        }
        if (Object.keys(clear).length > 0) {
            this.lastSentTitle = undefined;
            this.lastSentStateLabels = undefined;
            this.lastSentTokens = undefined;
            this.sentTokenKeys.clear();
            void this.send({
                id: requestId(`${this.source}:meta-clear`),
                method: 'pane.report_metadata',
                params: { pane_id: this.paneId, source: this.source, ...clear, seq: this.nextSeq() },
            });
        }
        void this.send({
            id: requestId(`${this.source}:release`),
            method: 'pane.release_agent',
            params: { pane_id: this.paneId, source: this.source, agent: this.agent },
        });
    }
    async drain() {
        if (this.sendInFlight)
            return;
        this.sendInFlight = true;
        try {
            while (this.queued !== undefined) {
                const next = this.queued;
                this.queued = undefined;
                const params = this.sessionParams();
                await this.send({
                    id: requestId(`${this.source}:state`),
                    method: 'pane.report_agent',
                    params: {
                        pane_id: this.paneId,
                        source: this.source,
                        agent: this.agent,
                        state: next.state,
                        ...(next.message !== undefined ? { message: next.message } : {}),
                        seq: next.seq,
                        ...params,
                    },
                });
            }
        }
        finally {
            this.sendInFlight = false;
            if (this.queued !== undefined)
                void this.drain();
        }
    }
}
//# sourceMappingURL=transport.js.map