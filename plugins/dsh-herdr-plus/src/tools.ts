/**
 * Herdr orchestration tools for the model.
 *
 * Four `herdr_agent_*` tools wrap the pane/agent CLI surface so a dsh agent
 * running inside a Herdr pane can launch sibling sessions, prompt them, wait
 * on their reported state, and read their output as single structured calls
 * instead of composing shell pipelines. Every call shells out to the Herdr
 * binary named by `HERDR_BIN_PATH` (or `herdr` on PATH) and normalizes its
 * JSON envelope / exit-1 error contract through `cli.ts`.
 *
 * @module dsh-herdr-plus/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'

import { runHerdrJson, runHerdrText } from './cli.js'
import type { HerdrCliFailure } from './cli.js'
import type { HerdrEnv } from './transport.js'

/** Herdr agent states accepted by `herdr_agent_wait`. */
const AGENT_STATES = ['idle', 'working', 'blocked', 'done', 'unknown'] as const

/** Pane ids look like `w8:pG` — `<workspace>:<pane>` alphanumeric segments. */
const PANE_ID_RE = /^w\S+:p\S+$/

/** Poll deadline for a split pane's shell prompt to render, in milliseconds. */
const SHELL_READY_TIMEOUT_MS = 10_000

/** Poll deadline for a spawned sibling's agent registration, in milliseconds. */
const AGENT_READY_TIMEOUT_MS = 20_000

/** Delay between readiness polls, in milliseconds. */
const POLL_INTERVAL_MS = 500

/** Options for {@link registerHerdrTools}. */
export interface HerdrToolOptions {
  /**
   * Command line `herdr_agent_spawn` runs in the sibling pane; the task is
   * appended as one shell-quoted argv word.
   */
  launchCommand: string
  /** Poll deadline for a fresh pane's shell prompt (test seam). */
  shellReadyTimeoutMs?: number
  /** Poll deadline for a spawned sibling's agent registration (test seam). */
  agentReadyTimeoutMs?: number
}

/** Dependencies shared by the four tool bodies. */
interface ToolDeps {
  env: HerdrEnv
  launchCommand: string
  shellReadyTimeoutMs: number
  agentReadyTimeoutMs: number
}

/** Herdr CLI failure as an `Error` the registry renders to the model. */
function asError(outcome: HerdrCliFailure, what: string): Error {
  return new Error(`${what} failed [${outcome.code}]: ${outcome.message}`)
}

/** Shell-quote one word for the `pane run` command line (single-quote style). */
function shellQuote(word: string): string {
  return `'${word.replaceAll(`'`, `'"'"'`)}'`
}

function delay(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms)
    timer.unref()
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve(false)
    }, { once: true })
  })
}

/** Read a field chain off a decoded `result` object. */
function agentRecord(result: Record<string, unknown>): Record<string, unknown> | undefined {
  const agent = result.agent
  return agent !== undefined && typeof agent === 'object' ? agent as Record<string, unknown> : undefined
}

/**
 * Resolve a model-supplied target to a pane id. `agent get` accepts agent
 * names and pane ids; when that fails and the target is pane-id shaped the
 * bare pane still resolves through `pane get`, so reads work on panes whose
 * agent never registered.
 */
async function resolvePane(
  deps: ToolDeps,
  target: string,
  signal: AbortSignal | undefined,
): Promise<{ paneId: string; agent?: Record<string, unknown> }> {
  const got = await runHerdrJson(deps.env, ['agent', 'get', target], { signal })
  if (got.ok) {
    const agent = agentRecord(got.result)
    if (agent !== undefined && typeof agent.pane_id === 'string') return { paneId: agent.pane_id, agent }
  } else if (got.code !== 'agent_not_found' || !PANE_ID_RE.test(target)) {
    throw asError(got, `agent get ${target}`)
  }
  if (PANE_ID_RE.test(target)) {
    const pane = await runHerdrJson(deps.env, ['pane', 'get', target], { signal })
    if (!pane.ok) throw asError(pane, `pane get ${target}`)
    return { paneId: target }
  }
  throw new Error(`agent get ${target} returned no agent record`)
}

/**
 * Poll until `probe` yields or the deadline passes. Returns the probe's last
 * value; `undefined` means the deadline elapsed.
 */
async function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined || Date.now() >= deadline) return value
    if (!(await delay(POLL_INTERVAL_MS, signal))) return undefined
  }
}

/**
 * Register the four `herdr_agent_*` tools on the tools service.
 * @param tools - the resolved `ctx.get('tools')` runtime.
 * @param env - pane environment carrying `HERDR_*` variables.
 * @param options - launch command and readiness deadlines.
 * @returns a disposer that unregisters every tool.
 */
export function registerHerdrTools(tools: ToolRuntime, env: HerdrEnv, options: HerdrToolOptions): () => void {
  const deps: ToolDeps = {
    env,
    launchCommand: options.launchCommand,
    shellReadyTimeoutMs: options.shellReadyTimeoutMs ?? SHELL_READY_TIMEOUT_MS,
    agentReadyTimeoutMs: options.agentReadyTimeoutMs ?? AGENT_READY_TIMEOUT_MS,
  }

  const spawn = tools.register(defineTool({
    name: 'herdr_agent_spawn',
    description:
      'Split a sibling pane in the current Herdr tab and launch a new dsh session in it ' +
      '(the configured launch command, default `mayfly`). Passes `task` as the session\'s first ' +
      'prompt argument, then waits for the sibling\'s own reporter to claim the pane. Use for ' +
      'parallel work; never use it to run shell commands — only the launch command runs.',
    parameters: {
      task: {
        type: 'string',
        description: 'First prompt sent to the sibling session at launch. Omit for a bare session.',
      },
      name: {
        type: 'string',
        description: 'Unique readable agent name ([a-z][a-z0-9_-]{0,31}) to rename the sibling to.',
      },
      cwd: {
        type: 'string',
        description: "Working directory for the sibling; defaults to this session's cwd.",
      },
      direction: {
        type: 'string',
        enum: ['right', 'down'],
        description: 'Split direction relative to this pane (default right).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pane_id: { type: 'string', required: true },
          registered: { type: 'boolean', required: true },
          agent: { type: 'string' },
          agent_status: { type: 'string' },
          name: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 90_000,
    async execute(args, exec) {
      const cwd = args.cwd ?? exec.agent?.session.header.cwd ?? process.cwd()
      const split = await runHerdrJson(deps.env, [
        'pane', 'split', '--current', '--direction', args.direction ?? 'right',
        '--cwd', cwd, '--no-focus',
      ], { signal: exec.signal })
      if (!split.ok) throw asError(split, 'pane split')
      const pane = split.result.pane as Record<string, unknown> | undefined
      const paneId = pane?.pane_id
      if (typeof paneId !== 'string') throw new Error('pane split reply carried no pane_id')

      // pane run needs the shell prompt rendered; poll the visible snapshot.
      await pollUntil(async () => {
        const read = await runHerdrText(deps.env, ['pane', 'read', paneId, '--source', 'visible', '--lines', '5'], { signal: exec.signal })
        return read.ok && read.text.trim() !== '' ? true : undefined
      }, deps.shellReadyTimeoutMs, exec.signal)

      const command = args.task !== undefined && args.task.trim() !== ''
        ? `${deps.launchCommand} ${shellQuote(args.task)}`
        : deps.launchCommand
      // pane run / send-* are silent on success, so the text runner is enough.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const run = await runHerdrText(deps.env, ['pane', 'run', paneId, command], { signal: exec.signal })
        if (run.ok) break
        if (attempt === 2) throw asError(run, 'pane run')
        await delay(1_000, exec.signal)
      }

      const registered = await pollUntil(async () => {
        const got = await runHerdrJson(deps.env, ['agent', 'get', paneId], { signal: exec.signal })
        return got.ok ? agentRecord(got.result) : undefined
      }, deps.agentReadyTimeoutMs, exec.signal)

      let name: string | undefined
      if (args.name !== undefined && registered !== undefined) {
        const renamed = await runHerdrText(deps.env, ['agent', 'rename', paneId, args.name], { signal: exec.signal })
        if (renamed.ok) name = args.name
      }

      return {
        pane_id: paneId,
        registered: registered !== undefined,
        ...(typeof registered?.agent === 'string' ? { agent: registered.agent } : {}),
        ...(typeof registered?.agent_status === 'string' ? { agent_status: registered.agent_status } : {}),
        ...(name !== undefined ? { name } : {}),
      }
    },
  }))

  const prompt = tools.register(defineTool({
    name: 'herdr_agent_prompt',
    description:
      'Send a follow-up prompt to a sibling agent: the text is typed into its pane and ' +
      'submitted with Enter. Refuses while the target is `blocked` on its own approval or ' +
      'question — read it first with herdr_agent_read and let the user answer in that pane.',
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Agent name (from herdr_agent_spawn) or pane id like w1:p2.',
      },
      text: { type: 'string', required: true, description: 'Prompt text to submit.' },
      wait: {
        type: 'boolean',
        description: 'Also wait until the agent settles (idle/done/blocked) before returning.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Wait deadline in milliseconds when wait is true (default 120000).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sent: { type: 'boolean', required: true },
          pane_id: { type: 'string', required: true },
          status: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 150_000,
    async execute(args, exec) {
      const { paneId, agent } = await resolvePane(deps, args.target, exec.signal)
      if (agent?.agent_status === 'blocked') {
        throw new Error(
          `agent "${args.target}" is blocked on its own approval or question; ` +
          'read it with herdr_agent_read and let the user answer in that pane first',
        )
      }
      const sent = await runHerdrText(deps.env, ['pane', 'send-text', paneId, args.text], { signal: exec.signal })
      if (!sent.ok) throw asError(sent, 'pane send-text')
      const keys = await runHerdrText(deps.env, ['pane', 'send-keys', paneId, 'enter'], { signal: exec.signal })
      if (!keys.ok) throw asError(keys, 'pane send-keys')
      if (args.wait !== true) return { sent: true, pane_id: paneId }
      return { sent: true, pane_id: paneId, status: await waitFor(deps, args.target, undefined, args.timeout_ms, exec.signal) }
    },
  }))

  const wait = tools.register(defineTool({
    name: 'herdr_agent_wait',
    description:
      'Wait until a sibling agent reaches a requested state. Defaults match Herdr: ' +
      'idle, done, or blocked (blocked means the sibling is waiting on its own approval ' +
      'or question — read it with herdr_agent_read before prompting it again).',
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Agent name (from herdr_agent_spawn) or pane id like w1:p2.',
      },
      until: {
        type: 'array',
        items: { type: 'string', enum: [...AGENT_STATES] },
        description: 'States that end the wait (default: idle, done, blocked).',
      },
      timeout_ms: {
        type: 'number',
        description: 'Wait deadline in milliseconds (default 120000).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          matched: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 150_000,
    async execute(args, exec) {
      const waited = await runHerdrJson(deps.env, waitArgs(args.target, args.until, args.timeout_ms), { signal: exec.signal })
      if (!waited.ok) {
        if (waited.code === 'timeout') return { status: 'timeout', matched: false }
        throw asError(waited, `agent wait ${args.target}`)
      }
      const agent = agentRecord(waited.result)
      return { status: typeof agent?.agent_status === 'string' ? agent.agent_status : 'unknown', matched: true }
    },
  }))

  const read = tools.register(defineTool({
    name: 'herdr_agent_read',
    description:
      'Read a sibling agent\'s pane output. `visible` shows its current screen; ' +
      '`recent-unwrapped` adds scrollback with wrapped lines joined; `detection` shows ' +
      'the bottom rows Herdr\'s agent detector sees.',
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Agent name (from herdr_agent_spawn) or pane id like w1:p2.',
      },
      source: {
        type: 'string',
        enum: ['visible', 'recent', 'recent-unwrapped', 'detection'],
        description: 'Snapshot source (default recent-unwrapped).',
      },
      lines: {
        type: 'number',
        description: 'Maximum lines to return (default 120).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pane_id: { type: 'string', required: true },
          source: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { paneId } = await resolvePane(deps, args.target, exec.signal)
      const source = args.source ?? 'recent-unwrapped'
      const read = await runHerdrText(deps.env, [
        'pane', 'read', paneId, '--source', source, '--lines', String(args.lines ?? 120),
      ], { signal: exec.signal })
      if (!read.ok) throw asError(read, `pane read ${paneId}`)
      return { pane_id: paneId, source, content: read.text }
    },
  }))

  return () => {
    spawn()
    prompt()
    wait()
    read()
  }
}

function waitArgs(target: string, until: readonly string[] | undefined, timeoutMs: number | undefined): string[] {
  const args = ['agent', 'wait', target]
  for (const state of until ?? []) args.push('--until', state)
  args.push('--timeout', String(timeoutMs ?? 120_000))
  return args
}

async function waitFor(
  deps: ToolDeps,
  target: string,
  until: readonly string[] | undefined,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const waited = await runHerdrJson(deps.env, waitArgs(target, until, timeoutMs), { signal })
  if (!waited.ok) return waited.code === 'timeout' ? 'timeout' : `error:${waited.code}`
  const agent = agentRecord(waited.result)
  return typeof agent?.agent_status === 'string' ? agent.agent_status : 'unknown'
}
