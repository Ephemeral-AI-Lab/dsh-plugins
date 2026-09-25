/**
 * Pure models for the pane's Herdr reports: the semantic agent state, the
 * session display facts (title, model, context), and the small formatting
 * helpers they share.
 *
 * @module dsh-herdr-plus/state
 */

/**
 * Compact token count like the dsh TUI's status bar: `988`, `3.4k`, `12k`,
 * `1.0M`. Negative values clamp to zero.
 * @param count - the raw token count.
 * @returns the compact display string.
 */
export function formatTokens(count: number): string {
  const value = Math.max(0, Math.round(count))
  if (value < 1000) return String(value)
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`
  if (value < 1000000) return `${Math.round(value / 1000)}k`
  if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`
  return `${Math.round(value / 1000000)}M`
}

/** The token-usage fields this integration reads from `assistant/message`. */
export interface UsageTokens {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Context occupancy from one `assistant/message` usage payload. The counts are
 * disjoint, so occupancy is the uncached input plus both cache fields.
 * `inputTokens` is the anchor: a sample without it carries no meaning.
 * @param usage - the usage payload, when one was reported.
 * @returns the occupancy in tokens, or undefined when the sample carries none.
 */
export function sumUsageTokens(usage: UsageTokens | undefined): number | undefined {
  if (usage === undefined || typeof usage.inputTokens !== 'number') return undefined
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * The `used/window` context display, mirroring the dsh TUI status bar
 * (`34k/1.0M`). Bare `used` when the window is unknown; nothing before the
 * first usage sample.
 * @param used - occupied context tokens.
 * @param contextWindow - the route's advertised context window, when known.
 * @returns the display string, or undefined before the first usage sample.
 */
export function formatContextUsage(used: number | undefined, contextWindow: number | undefined): string | undefined {
  if (used === undefined) return undefined
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow)) return formatTokens(used)
  return `${formatTokens(used)}/${formatTokens(contextWindow)}`
}

/** The state-label keys Herdr accepts on pane metadata. */
const STATE_LABEL_KEYS = ['idle', 'working', 'blocked', 'done', 'unknown'] as const

/**
 * Keep only the five known state-label keys with non-blank text, trimmed.
 * @param labels - configured labels keyed by Herdr state.
 * @returns the wire payload, or undefined when nothing survives.
 */
export function stateLabelsPayload(labels: Record<string, string> | undefined): Record<string, string> | undefined {
  const payload: Record<string, string> = {}
  for (const key of STATE_LABEL_KEYS) {
    const value = labels?.[key]
    if (typeof value === 'string' && value.trim() !== '') payload[key] = value.trim()
  }
  return Object.keys(payload).length > 0 ? payload : undefined
}

/** The pane's semantic agent state as Herdr understands it. */
export type PaneState = 'working' | 'blocked' | 'idle'

/** One pane state report: the state plus an optional human label. */
export interface PaneStateReport {
  state: PaneState
  message?: string
}

/**
 * Pure semantic state model for the pane's Herdr state.
 */
export class AgentStateModel {
  /** Agent objects reported as `running`, by identity (stable per session). */
  private readonly runningAgents = new Set<unknown>()
  /** Number of open approval/question interactions. */
  private blockedCount = 0
  /** Label of the most recently opened blocked interaction. */
  private blockedMessage: string | undefined
  /** Tool calls that survived approval and are still running, by call id. */
  private readonly tools = new Map<string, string>()

  /**
   * Record one agent's running state; pass the same agent object on later events.
   * @param agent - the agent whose status changed.
   * @param running - whether it entered `running`.
   */
  setRunning(agent: unknown, running: boolean): void {
    if (running) this.runningAgents.add(agent)
    else this.runningAgents.delete(agent)
  }

  /**
   * Open or close one blocked interaction. `active: true` opens a pending
   * approval/question and records `message`; `active: false` closes the most
   * recent one (never below zero).
   * @param active - whether an interaction opened (true) or settled (false).
   * @param message - the interaction's human label, when opening.
   */
  setBlocked(active: boolean, message?: string): void {
    if (active) {
      this.blockedCount += 1
      if (message !== undefined) this.blockedMessage = message
      return
    }
    this.blockedCount = Math.max(0, this.blockedCount - 1)
    if (this.blockedCount === 0) this.blockedMessage = undefined
  }

  /**
   * A tool call survived approval and is about to run (`tools/execute`).
   * @param callId - the tool call's id.
   * @param name - the tool's display name.
   */
  toolStarted(callId: string, name: string): void {
    this.tools.set(callId, name)
  }

  /**
   * The call settled (`tools/result`, or the execute waterfall's finally).
   * Idempotent; an unknown call id is a no-op.
   * @param callId - the finished tool call's id.
   */
  toolFinished(callId: string): void {
    this.tools.delete(callId)
  }

  /** The most recently started still-active tool name, or undefined. */
  private currentTool(): string | undefined {
    const names = [...this.tools.values()]
    return names.length > 0 ? names[names.length - 1] : undefined
  }

  /**
   * The report derived from the current inputs. A blocked interaction labels
   * itself; a working pane labels itself with the current tool, when one is
   * active.
   * @returns the state report to publish.
   */
  desired(): PaneStateReport {
    if (this.blockedCount > 0) {
      return this.blockedMessage !== undefined
        ? { state: 'blocked', message: this.blockedMessage }
        : { state: 'blocked' }
    }
    if (this.runningAgents.size > 0) {
      const tool = this.currentTool()
      return tool !== undefined ? { state: 'working', message: tool } : { state: 'working' }
    }
    return { state: 'idle' }
  }
}

/** The token keys this integration reports. */
const TOKEN_KEYS = ['model', 'ctx'] as const

/** Shallow, undefined-tolerant equality for the small token/label payloads. */
function shallowEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Display facts a session may already carry when it starts. */
export interface SessionFacts {
  title?: string | undefined
  model?: string | undefined
  contextWindow?: number | undefined
  usedTokens?: number | undefined
}

/** One publishable metadata patch: a changed title and/or token keys. */
export interface FactsPatch {
  title?: string
  tokens?: Record<string, string | null>
}

/** The envelope shape {@link SessionFactsModel.observeEvent} folds. */
export interface ObservedEvent {
  type: string
  data?: unknown
}

/**
 * Tracks which session's display facts are current — title, model, context
 * window, context occupancy — and decides, from session-start seeds and the
 * session-log feed, what changed enough to publish.
 */
export class SessionFactsModel {
  /** Session identity from the latest agent/session-start. */
  private sessionId: string | undefined
  /** Latest applicable title for that session. */
  private title: string | undefined
  /** Latest model id from request/header config. */
  private model: string | undefined
  /** Advertised context window in tokens, when known. */
  private contextWindow: number | undefined
  /** Context occupancy from the latest assistant/message usage sample. */
  private usedTokens: number | undefined
  /** Last title this model published (change tracking; resets per session). */
  private lastReportedTitle: string | undefined
  /**
   * Last tokens snapshot this model published against (present-only). Kept
   * across sessions so a key that becomes unknown is null-cleared rather
   * than left stale on the pane.
   */
  private lastReportedTokens: Record<string, string> | undefined

  /**
   * The tracked session changed (agent/session-start). Adopts the new identity
   * and any pre-existing facts — a resumed session's log predates the plugin.
   * Title change tracking resets so an identical title re-publishes; token
   * tracking persists so stale keys are null-cleared.
   * @param sessionId - the new session's identity, when one exists.
   * @param initial - pre-existing facts seeded from the session log.
   * @returns the publishable patch, when anything changed.
   */
  setSession(sessionId: string | undefined, initial: SessionFacts = {}): FactsPatch | undefined {
    this.sessionId = sessionId
    this.title = initial.title
    this.model = typeof initial.model === 'string' && initial.model !== '' ? initial.model : undefined
    this.contextWindow = Number.isFinite(initial.contextWindow) ? initial.contextWindow : undefined
    this.usedTokens = Number.isFinite(initial.usedTokens) ? initial.usedTokens : undefined
    this.lastReportedTitle = undefined
    return this.takePublishable()
  }

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
  observeEvent(sessionId: string | undefined, event: ObservedEvent): FactsPatch | undefined {
    if (this.sessionId === undefined) this.sessionId = sessionId
    if (sessionId === undefined || sessionId !== this.sessionId) return undefined
    switch (event.type) {
      case 'session/title': {
        const title = (event.data as { title?: unknown } | undefined)?.title
        if (typeof title === 'string') this.title = title
        break
      }
      case 'request/header': {
        const model = (event.data as { header?: { config?: { model?: unknown } } } | undefined)
          ?.header?.config?.model
        if (typeof model === 'string' && model !== '') this.model = model
        break
      }
      case 'request/context': {
        const window = (event.data as { contextWindow?: unknown } | undefined)?.contextWindow
        this.contextWindow = typeof window === 'number' && Number.isFinite(window) ? window : undefined
        break
      }
      case 'assistant/message': {
        const used = sumUsageTokens((event.data as { usage?: UsageTokens } | undefined)?.usage)
        if (used !== undefined) this.usedTokens = used
        break
      }
      default:
        return undefined
    }
    return this.takePublishable()
  }

  /** The publishable title, when it is a non-blank string. */
  desiredTitle(): string | undefined {
    return typeof this.title === 'string' && this.title.trim() !== '' ? this.title : undefined
  }

  /** The publishable tokens snapshot, present-only. */
  desiredTokens(): Record<string, string> {
    const tokens: Record<string, string> = {}
    if (this.model !== undefined) tokens.model = this.model
    const ctx = formatContextUsage(this.usedTokens, this.contextWindow)
    if (ctx !== undefined) tokens.ctx = ctx
    return tokens
  }

  /**
   * Consume the changed facts once, tracking them as reported. Token payloads
   * are key-level patches: a fresh value is sent as-is, a key that became
   * unknown after being reported is sent as null (explicit clear), and a key
   * never reported is omitted.
   * @returns the publishable patch, when anything changed.
   */
  private takePublishable(): FactsPatch | undefined {
    const out: FactsPatch = {}
    const title = this.desiredTitle()
    if (title !== undefined && title !== this.lastReportedTitle) {
      this.lastReportedTitle = title
      out.title = title
    }
    const current = this.desiredTokens()
    if (!shallowEqual(current, this.lastReportedTokens)) {
      const payload: Record<string, string | null> = {}
      for (const key of TOKEN_KEYS) {
        const value = current[key]
        if (value !== undefined) payload[key] = value
        else if (this.lastReportedTokens?.[key] !== undefined) payload[key] = null
      }
      if (Object.keys(payload).length > 0) {
        this.lastReportedTokens = current
        out.tokens = payload
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
}
