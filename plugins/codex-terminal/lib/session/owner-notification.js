import { randomUUID } from 'node:crypto';
export function createSessionExitNotification(id, exit) {
    const code = exit.exitCode ?? 'unknown';
    const summary = `exec job ${id} exited with code ${code}`;
    return Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: [{
                type: 'text',
                text: `${summary}. Call write_stdin with job_id=${JSON.stringify(id)} and chars="" to collect the remaining output.`,
            }],
        source: {
            kind: 'plugin',
            plugin: 'codex-terminal',
            form: 'notice',
            summary,
        },
    });
}
//# sourceMappingURL=owner-notification.js.map