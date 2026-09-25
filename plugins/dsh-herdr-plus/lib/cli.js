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
import { execFile } from 'node:child_process';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4 * 1024 * 1024;
/** Resolve the herdr executable: the pane-injected path first, PATH second. */
export function herdrBin(env) {
    return env.HERDR_BIN_PATH ?? 'herdr';
}
function execHerdr(env, args, options) {
    return new Promise((resolve) => {
        execFile(herdrBin(env), args, {
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            signal: options.signal,
            maxBuffer: MAX_BUFFER,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error === null) {
                resolve({ code: 0, stdout, stderr, timedOut: false, aborted: false });
                return;
            }
            resolve({
                code: typeof error.code === 'number' ? error.code : null,
                stdout,
                stderr,
                timedOut: error.killed === true && error.signal === 'SIGTERM',
                aborted: error.name === 'AbortError',
            });
        });
    });
}
function parseErrorEnvelope(stderr) {
    try {
        const parsed = JSON.parse(stderr);
        if (parsed.error !== undefined && typeof parsed.error === 'object') {
            return {
                code: typeof parsed.error.code === 'string' ? parsed.error.code : 'cli_error',
                message: typeof parsed.error.message === 'string' ? parsed.error.message : stderr.trim(),
            };
        }
    }
    catch {
        // Not a JSON envelope: the raw stderr text is the message.
    }
    return undefined;
}
function failure(exit) {
    if (exit.aborted)
        return { ok: false, code: 'aborted', message: 'herdr call aborted' };
    if (exit.timedOut)
        return { ok: false, code: 'timeout', message: 'herdr call timed out' };
    const envelope = parseErrorEnvelope(exit.stderr);
    if (envelope !== undefined)
        return { ok: false, ...envelope };
    const detail = exit.stderr.trim() || exit.stdout.trim();
    if (exit.code === null)
        return { ok: false, code: 'spawn_failed', message: detail || 'failed to spawn herdr' };
    return { ok: false, code: 'cli_error', message: detail || `herdr exited with code ${exit.code}` };
}
/**
 * Run a JSON-envelope `herdr` command.
 * @param env - pane environment carrying `HERDR_BIN_PATH`.
 * @param args - CLI arguments, e.g. `['pane', 'split', '--current']`.
 * @param options - cancellation and deadline.
 * @returns the parsed `result` object or a normalized failure.
 */
export async function runHerdrJson(env, args, options = {}) {
    const exit = await execHerdr(env, args, options);
    if (exit.code !== 0 || exit.timedOut || exit.aborted)
        return failure(exit);
    try {
        const parsed = JSON.parse(exit.stdout);
        if (parsed.result !== undefined && typeof parsed.result === 'object') {
            return { ok: true, result: parsed.result };
        }
        return { ok: false, code: 'bad_output', message: 'herdr reply carried no result object' };
    }
    catch {
        return { ok: false, code: 'bad_output', message: `unparseable herdr reply: ${exit.stdout.trim().slice(0, 200)}` };
    }
}
/**
 * Run a plain-text `herdr` command (`pane read`, `pane wait-output`).
 * @param env - pane environment carrying `HERDR_BIN_PATH`.
 * @param args - CLI arguments.
 * @param options - cancellation and deadline.
 * @returns the raw stdout text or a normalized failure.
 */
export async function runHerdrText(env, args, options = {}) {
    const exit = await execHerdr(env, args, options);
    if (exit.code !== 0 || exit.timedOut || exit.aborted)
        return failure(exit);
    return { ok: true, text: exit.stdout };
}
//# sourceMappingURL=cli.js.map