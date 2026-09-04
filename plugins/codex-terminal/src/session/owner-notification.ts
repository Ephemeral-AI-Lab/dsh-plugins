import { randomUUID } from 'node:crypto'
import type { ExitStatus, SessionNotification } from '../types.js'

export function createSessionExitNotification(id: string, exit: ExitStatus): SessionNotification {
  const code = exit.exitCode ?? 'unknown'
  const summary = `exec job ${id} exited with code ${code}`
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: `${summary}. Call write_stdin with job_id=${JSON.stringify(id)} and chars="" to collect the remaining output.`,
    }] as const,
    source: {
      kind: 'plugin' as const,
      plugin: 'codex-terminal' as const,
      form: 'notice' as const,
      summary,
    },
  })
}
