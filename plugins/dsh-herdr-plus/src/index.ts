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

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

import { makeHerdrSkillProvider } from './skill.js'
import { AgentStateModel, SessionFactsModel, stateLabelsPayload, sumUsageTokens } from './state.js'
import type { SessionFacts } from './state.js'
import { HerdrReporter, herdrEnabled } from './transport.js'

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
    'user-questions/request'(
      request: { questions: AskUserQuestionItem[] },
      next: () => Promise<AskUserQuestionAnswer>,
    ): Promise<AskUserQuestionAnswer>
  }
}

export const name = 'dsh-herdr-plus'

/** The plugin consumes no injected services; it reads the environment and events only. */
export const inject: string[] = []

/** Display text per Herdr state; non-blank entries become pane state labels. */
export type StateLabels = {
  idle: string
  working: string
  blocked: string
  done: string
  unknown: string
}

/** Plugin configuration; every field has a schema default. */
export interface Config {
  /**
   * Herdr agent label reported for the pane. A host frontend sets its own name
   * (e.g. `blue`) by overriding this field in a patch overlay.
   */
  agent: string
  /**
   * Stable, unique integration source. Keep it constant so Herdr attributes the
   * pane's lifecycle authority to this reporter and so a second reporter can
   * coexist under a different source.
   */
  source: string
  /**
   * Transport to Herdr. `socket` speaks the pane socket directly; `cli` is a
   * declared-but-unimplemented fallback and is rejected at load.
   */
  transport: 'socket' | 'cli'
  /** Report the pane's session reference so Herdr can expose it for restore. */
  reportSession: boolean
  /**
   * Which title to publish as the Herdr pane title (display-only metadata).
   * `session` mirrors the dsh session title — first-prompt fallback,
   * LLM-generated, or pinned by `/rename`; `none` disables title reporting.
   */
  title: 'session' | 'none'
  /** Whether to attach a human label to blocked reports. */
  message: 'tool' | 'none'
  /** Whether to attach the currently-executing tool name to working reports. */
  workingMessage: 'tool' | 'none'
  /**
   * Report the model id (`model`) and context usage (`ctx`, `used/window`
   * mirroring the dsh TUI status bar) as Herdr Agent-sidebar tokens.
   */
  tokens: 'auto' | 'none'
  /**
   * Display text per Herdr state; non-blank entries become pane state labels
   * (e.g. `{ working: 工作中, blocked: 等待确认 }`). All-blank disables them.
   */
  stateLabels: StateLabels
  /**
   * `auto` registers the `herdr_agent_*` orchestration tools when the profile
   * mounts the tools service; `none` keeps the plugin report-only.
   */
  tools: 'auto' | 'none'
  /**
   * `auto` contributes the `herdr` skill when the profile mounts the skills
   * service, preferring the installed binary's `herdr --skill` output;
   * `bundled` serves only the vendored copy (no subprocess); `none`
   * contributes nothing.
   */
  skill: 'auto' | 'bundled' | 'none'
  /**
   * Command line `herdr_agent_spawn` runs in the sibling pane; the task is
   * appended as one shell-quoted argv word (e.g. `mayfly`, or
   * `dsh --profile mayfly`).
   */
  launchCommand: string
  /** Kill-switch for coexisting with another reporter in the same tree. */
  enabled: boolean
}

/** Schemastery configuration for the plugin. */
export const Config: z<Config> = z.object({
  agent: z.string().default('mayfly'),
  source: z.string().default('herdr:dsh-herdr-plus'),
  transport: z.union([z.const('socket'), z.const('cli')]).default('socket'),
  reportSession: z.boolean().default(true),
  title: z.union([z.const('session'), z.const('none')]).default('session'),
  message: z.union([z.const('tool'), z.const('none')]).default('tool'),
  workingMessage: z.union([z.const('tool'), z.const('none')]).default('tool'),
  tokens: z.union([z.const('auto'), z.const('none')]).default('auto'),
  tools: z.union([z.const('auto'), z.const('none')]).default('auto'),
  skill: z.union([z.const('auto'), z.const('bundled'), z.const('none')]).default('auto'),
  launchCommand: z.string().default('mayfly'),
  stateLabels: z.object({
    idle: z.string().default(''),
    working: z.string().default(''),
    blocked: z.string().default(''),
    done: z.string().default(''),
    unknown: z.string().default(''),
  }).default({ idle: '', working: '', blocked: '', done: '', unknown: '' }),
  enabled: z.boolean().default(true),
})

/** A concise human label for the leading question in a pending request. */
function questionLabel(questions: AskUserQuestionItem[]): string {
  const item = questions[0]
  const text = item?.header ?? item?.question ?? 'question'
  return questions.length > 1 ? `${text} (+${questions.length - 1} more)` : text
}

/**
 * Seed model / context window / context occupancy from the replayed session
 * log. A resumed session's past events are constructor seeds that never re-fire
 * on the live session/event feed, so the initial facts come from the log.
 * @param session - the agent's live session.
 * @returns the facts recoverable from its replayed event log.
 */
function seedSessionFacts(session: Session | undefined): SessionFacts {
  const events = session?.events
  if (events === undefined) return {}
  const model = events.findLast((e): e is SessionEvent<'request/header'> => e.type === 'request/header')
    ?.data.header.config.model
  const context = events.findLast((e): e is SessionEvent<'request/context'> => e.type === 'request/context')
    ?.data.contextWindow
  const used = sumUsageTokens(
    events.findLast((e): e is SessionEvent<'assistant/message'> => e.type === 'assistant/message')?.data.usage,
  )
  return {
    ...(typeof model === 'string' && model !== '' ? { model } : {}),
    ...(typeof context === 'number' && Number.isFinite(context) ? { contextWindow: context } : {}),
    ...(used !== undefined ? { usedTokens: used } : {}),
  }
}

/**
 * Drive one pane's reporter from the live dsh event stream.
 * @param ctx - the plugin's host context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  if (config.transport !== 'socket') {
    throw new Error(`dsh-herdr-plus: transport "${String(config.transport)}" is not implemented; use 'socket'`)
  }

  const env = process.env
  if (!herdrEnabled(env)) return

  const skills = ctx.get('skills')
  if (config.skill !== 'none' && skills !== undefined) {
    const mode = config.skill
    ctx.effect(
      () => skills.registerProvider(() => makeHerdrSkillProvider({ env, mode })),
      'dsh-herdr-plus: unregister the herdr skill provider',
    )
  }

  const tools = ctx.get('tools')
  if (config.tools === 'auto' && tools !== undefined) {
    // Dynamic import keeps the reporter loadable in profiles where the
    // dsh-tools package is absent from the install tree entirely. `alive`
    // skips registration if the plugin unloaded while the module resolved.
    let alive = true
    ctx.effect(() => () => { alive = false }, 'dsh-herdr-plus: track unload during tools import')
    void import('./tools.js').then(
      ({ registerHerdrTools }) => {
        if (!alive) return
        ctx.effect(
          () => registerHerdrTools(tools, env, { launchCommand: config.launchCommand }),
          'dsh-herdr-plus: unregister herdr orchestration tools',
        )
      },
      () => ctx.logger.warn('dsh-herdr-plus: herdr_agent_* tools disabled (tools module unavailable)'),
    )
  }

  const reporter = new HerdrReporter({
    source: config.source,
    agent: config.agent,
    reportSession: config.reportSession,
    reportTitle: config.title !== 'none',
    reportTokens: config.tokens !== 'none',
    env,
  })
  const model = new AgentStateModel()
  const factsModel = new SessionFactsModel()
  const stateLabels = stateLabelsPayload(config.stateLabels)

  const publish = (force = false) => {
    const report = model.desired()
    if (report.state === 'blocked' && config.message === 'none') {
      reporter.publishState({ state: report.state }, force)
    } else if (report.state === 'working' && config.workingMessage === 'none') {
      reporter.publishState({ state: report.state }, force)
    } else {
      reporter.publishState(report, force)
    }
  }

  ctx.on('agent/disposed', (payload) => {
    model.setRunning(payload.agent, false)
    publish()
  })

  ctx.on('agent/status', (payload) => {
    model.setRunning(payload.agent, payload.status === 'running')
    publish()
  })

  // Observers only: they delegate with `await next()` and never alter the
  // downstream decision, so the approval / question / tool flows are untouched.
  ctx.on('approval/request', async (req, next) => {
    model.setBlocked(true, req.reason ?? req.toolName)
    publish()
    try {
      return await next()
    } finally {
      model.setBlocked(false)
      publish()
    }
  })

  ctx.on('user-questions/request', async (request, next) => {
    model.setBlocked(true, questionLabel(request.questions))
    publish()
    try {
      return await next()
    } finally {
      model.setBlocked(false)
      publish()
    }
  })

  // The dispatch waterfall fires only for calls that survived approval, so the
  // label names a tool that is really about to run; tools/result (and the
  // finally below) close it by call id.
  ctx.on('tools/execute', async (exec, next) => {
    model.toolStarted(exec.callId, exec.name)
    publish()
    try {
      return await next()
    } finally {
      model.toolFinished(exec.callId)
      publish()
    }
  })

  ctx.on('tools/result', (exec) => {
    model.toolFinished(exec.callId)
    publish()
  })

  // Post-commit feed of appended session-log events; the facts model keeps
  // only title / model / context commits for the tracked session (child and
  // subagent sessions in this process are skipped by the session-id match).
  ctx.on('session/event', (session, event) => {
    switch (event.type) {
      case 'session/title':
      case 'request/header':
      case 'request/context':
      case 'assistant/message':
        break
      default:
        return
    }
    reporter.reportMetadata(factsModel.observeEvent(session.header.id, event))
  })

  ctx.on('agent/session-start', (payload) => {
    const session = payload.agent.session
    const sessionId = session.header.id
    reporter.setSessionId(sessionId)

    // Absolute jsonl log path, when a locating persistence backend is mounted.
    let sessionPath: string | undefined
    try {
      const located = ctx.get('sessionPersistence')?.locate(session.header)
      if (located?.kind === 'jsonl' && located.path !== '') {
        sessionPath = located.path
      }
    } catch {
      // Service not mounted in this host: the session id still reports.
    }
    reporter.setSessionPath(sessionPath)

    reporter.reportSession(payload.source)
    model.setRunning(payload.agent, false)
    publish(true)

    // Initial display facts: the title via the title service, the rest seeded
    // from the replayed log; static state labels ride the same request. Sent
    // after publish(true) so the authority claim precedes the guarded fields.
    let initialTitle: string | undefined
    try {
      initialTitle = ctx.get('sessionTitle')?.get(session)?.title
    } catch {
      // Service not mounted or session not live: the feed covers the rest.
    }
    reporter.reportMetadata({
      ...factsModel.setSession(sessionId, {
        ...(initialTitle !== undefined ? { title: initialTitle } : {}),
        ...seedSessionFacts(session),
      }),
      ...(stateLabels !== undefined ? { state_labels: stateLabels } : {}),
    })
  })

  ctx.effect(
    () => () => reporter.release(),
    'dsh-herdr-plus: release pane lifecycle authority on unload',
  )
  process.once('beforeExit', () => reporter.release())
}
