/**
 * Minimal Herdr CLI runner shared by the orchestration tools.
 *
 * Most `herdr` commands print one JSON envelope on stdout
 * (`{ id, result }`) and report command failures as a JSON envelope on stderr
 * (`{ id, error: { code, message } }`, exit 1); a few output commands such as
 * `pane read` print plain text instead. Both paths normalize to a
 * discriminated result and never throw — a missing or failing `herdr` binary
 * becomes a tool error, not a host crash.
 *
 * @module dsh-herdr-plus/cli
 */
import type { HerdrEnv } from './transport.js';
/** A Herdr CLI failure: exit-1 error envelopes carry `code`/`message`. */
export interface HerdrCliFailure {
    ok: false;
    code: string;
    message: string;
}
/** Structured (`{ id, result }`) command outcome. */
export type HerdrJsonResult = {
    ok: true;
    result: Record<string, unknown>;
} | HerdrCliFailure;
/** Plain-text (`pane read`, `pane wait-output`) command outcome. */
export type HerdrTextResult = {
    ok: true;
    text: string;
} | HerdrCliFailure;
/** Options for one CLI invocation. */
export interface RunHerdrOptions {
    /** Cooperative cancellation forwarded from the tool execution. */
    signal?: AbortSignal | undefined;
    /** Child-process deadline in milliseconds. */
    timeoutMs?: number;
}
/** Resolve the herdr executable: the pane-injected path first, PATH second. */
export declare function herdrBin(env: HerdrEnv): string;
/**
 * Run a JSON-envelope `herdr` command.
 * @param env - pane environment carrying `HERDR_BIN_PATH`.
 * @param args - CLI arguments, e.g. `['pane', 'split', '--current']`.
 * @param options - cancellation and deadline.
 * @returns the parsed `result` object or a normalized failure.
 */
export declare function runHerdrJson(env: HerdrEnv, args: string[], options?: RunHerdrOptions): Promise<HerdrJsonResult>;
/**
 * Run a plain-text `herdr` command (`pane read`, `pane wait-output`).
 * @param env - pane environment carrying `HERDR_BIN_PATH`.
 * @param args - CLI arguments.
 * @param options - cancellation and deadline.
 * @returns the raw stdout text or a normalized failure.
 */
export declare function runHerdrText(env: HerdrEnv, args: string[], options?: RunHerdrOptions): Promise<HerdrTextResult>;
//# sourceMappingURL=cli.d.ts.map