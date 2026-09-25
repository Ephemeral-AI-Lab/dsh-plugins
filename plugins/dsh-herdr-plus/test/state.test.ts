import { describe, expect, it } from 'vitest'

import {
  AgentStateModel,
  SessionFactsModel,
  formatContextUsage,
  formatTokens,
  stateLabelsPayload,
  sumUsageTokens,
} from '../src/state.js'

describe('AgentStateModel', () => {
  it('defaults to idle', () => {
    expect(new AgentStateModel().desired()).toEqual({ state: 'idle' })
  })

  it('reports working while any agent is running and idle when none are', () => {
    const model = new AgentStateModel()
    const primary = { id: 'primary' }
    const child = { id: 'child' }

    model.setRunning(primary, true)
    expect(model.desired()).toEqual({ state: 'working' })

    model.setRunning(child, true)
    expect(model.desired()).toEqual({ state: 'working' })

    model.setRunning(primary, false)
    expect(model.desired()).toEqual({ state: 'working' })

    model.setRunning(child, false)
    expect(model.desired()).toEqual({ state: 'idle' })
  })

  it('reports blocked ahead of working, until every interaction settles', () => {
    const model = new AgentStateModel()
    const agent = { id: 'primary' }
    model.setRunning(agent, true)

    model.setBlocked(true, 'fs:write')
    expect(model.desired()).toEqual({ state: 'blocked', message: 'fs:write' })

    model.setBlocked(true, 'exec')
    expect(model.desired()).toEqual({ state: 'blocked', message: 'exec' })

    model.setBlocked(false)
    // one still open -> still blocked
    expect(model.desired()).toEqual({ state: 'blocked', message: 'exec' })

    model.setBlocked(false)
    // all settled -> back to working
    expect(model.desired()).toEqual({ state: 'working' })
  })

  it('drops the message when the last blocked interaction closes', () => {
    const model = new AgentStateModel()
    model.setBlocked(true, 'ask')
    expect(model.desired()).toEqual({ state: 'blocked', message: 'ask' })
    model.setBlocked(false)
    expect(model.desired()).toEqual({ state: 'idle' })
  })

  it('never decrements below zero on a stale close', () => {
    const model = new AgentStateModel()
    model.setBlocked(false)
    expect(model.desired()).toEqual({ state: 'idle' })
  })

  it('does not smear a prior blocked message into later states', () => {
    const model = new AgentStateModel()
    const agent = { id: 'primary' }
    model.setRunning(agent, true)
    model.setBlocked(true, 'approve')
    model.setBlocked(false)
    expect(model.desired()).toEqual({ state: 'working' })
  })

  it('labels working with the current tool', () => {
    const model = new AgentStateModel()
    model.setRunning({ id: 'primary' }, true)
    model.toolStarted('c1', 'fs:read')
    expect(model.desired()).toEqual({ state: 'working', message: 'fs:read' })
  })

  it('follows the most recently started active tool and drops the message when all finish', () => {
    const model = new AgentStateModel()
    model.setRunning({ id: 'primary' }, true)
    model.toolStarted('c1', 'fs:read')
    model.toolStarted('c2', 'fs:edit')
    expect(model.desired()).toEqual({ state: 'working', message: 'fs:edit' })

    model.toolFinished('c2')
    expect(model.desired()).toEqual({ state: 'working', message: 'fs:read' })

    model.toolFinished('c1')
    expect(model.desired()).toEqual({ state: 'working' })
  })

  it('treats a finish for an unknown call id as a no-op', () => {
    const model = new AgentStateModel()
    model.toolFinished('nope')
    expect(model.desired()).toEqual({ state: 'idle' })
  })

  it('does not smear an active tool into idle', () => {
    const model = new AgentStateModel()
    model.toolStarted('c1', 'fs:read')
    expect(model.desired()).toEqual({ state: 'idle' })
  })

  it('keeps blocked ahead of the working tool label', () => {
    const model = new AgentStateModel()
    model.setRunning({ id: 'primary' }, true)
    model.toolStarted('c1', 'fs:read')
    model.setBlocked(true, 'approve')
    expect(model.desired()).toEqual({ state: 'blocked', message: 'approve' })
  })
})

describe('formatTokens', () => {
  it('matches the dsh TUI compact format exactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(3400)).toBe('3.4k')
    expect(formatTokens(9999)).toBe('10.0k')
    expect(formatTokens(10000)).toBe('10k')
    expect(formatTokens(999999)).toBe('1000k')
    expect(formatTokens(1000000)).toBe('1.0M')
    expect(formatTokens(9500000)).toBe('9.5M')
    expect(formatTokens(10000000)).toBe('10M')
    expect(formatTokens(-5)).toBe('0')
  })
})

describe('sumUsageTokens', () => {
  it('sums the disjoint occupancy fields', () => {
    expect(sumUsageTokens({ inputTokens: 100 })).toBe(100)
    expect(sumUsageTokens({ inputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 50 })).toBe(350)
    expect(sumUsageTokens({ inputTokens: 100, cacheReadTokens: 200 })).toBe(300)
  })

  it('returns undefined without an inputTokens anchor', () => {
    expect(sumUsageTokens({ cacheReadTokens: 200 })).toBeUndefined()
    expect(sumUsageTokens(undefined)).toBeUndefined()
  })
})

describe('formatContextUsage', () => {
  it('renders used/window, bare used, and nothing before the first usage', () => {
    expect(formatContextUsage(34000, 1000000)).toBe('34k/1.0M')
    expect(formatContextUsage(500, undefined)).toBe('500')
    expect(formatContextUsage(undefined, 1000000)).toBeUndefined()
    expect(formatContextUsage(9800, 10000)).toBe('9.8k/10k')
  })
})

describe('stateLabelsPayload', () => {
  it('keeps the five known keys, trims text, and drops blanks and unknowns', () => {
    expect(stateLabelsPayload({})).toBeUndefined()
    expect(stateLabelsPayload(undefined)).toBeUndefined()
    expect(stateLabelsPayload({ working: ' 思考中 ' })).toEqual({ working: '思考中' })
    expect(stateLabelsPayload({ idle: '', blocked: 'waiting' })).toEqual({ blocked: 'waiting' })
    expect(stateLabelsPayload({ done: 'done', unknown: '?' })).toEqual({ done: 'done', unknown: '?' })
    expect(stateLabelsPayload({ extra: 'x' })).toBeUndefined()
  })
})

describe('SessionFactsModel', () => {
  it('publishes pre-existing facts when a session starts', () => {
    const model = new SessionFactsModel()
    expect(model.setSession('s1', { title: 'Fix login' })).toEqual({ title: 'Fix login' })
    expect(model.desiredTitle()).toBe('Fix login')
  })

  it('publishes nothing when the new session has no facts yet', () => {
    const model = new SessionFactsModel()
    expect(model.setSession('s1')).toBeUndefined()
  })

  it('seeds tokens from initial facts', () => {
    const model = new SessionFactsModel()
    expect(model.setSession('s1', { model: 'deepseek-chat', contextWindow: 128000, usedTokens: 34000 })).toEqual({
      tokens: { model: 'deepseek-chat', ctx: '34k/128k' },
    })
  })

  it('omits a ctx token when no usage is known yet', () => {
    const model = new SessionFactsModel()
    expect(model.setSession('s1', { model: 'deepseek-chat' })).toEqual({ tokens: { model: 'deepseek-chat' } })
  })

  it('publishes the model from request/header and dedupes repeats', () => {
    const model = new SessionFactsModel()
    const event = { type: 'request/header', data: { header: { config: { model: 'deepseek-chat' } }, reason: 'initial' } }
    expect(model.observeEvent('s1', event)).toEqual({ tokens: { model: 'deepseek-chat' } })
    expect(model.observeEvent('s1', event)).toBeUndefined()
  })

  it('combines request/context and assistant/message usage into ctx', () => {
    const model = new SessionFactsModel()
    expect(
      model.observeEvent('s1', { type: 'request/context', data: { provider: 'p', model: 'm', contextWindow: 10000 } }),
    ).toBeUndefined()
    expect(model.observeEvent('s1', { type: 'assistant/message', data: { usage: { inputTokens: 9800 } } })).toEqual({
      tokens: { ctx: '9.8k/10k' },
    })
  })

  it('renders bare used when the context window is unknown', () => {
    const model = new SessionFactsModel()
    expect(model.observeEvent('s1', { type: 'assistant/message', data: { usage: { inputTokens: 34000 } } })).toEqual({
      tokens: { ctx: '34k' },
    })
  })

  it('degrades a known window to bare used when a later context event omits it', () => {
    const model = new SessionFactsModel()
    model.observeEvent('s1', { type: 'request/context', data: { contextWindow: 10000 } })
    model.observeEvent('s1', { type: 'assistant/message', data: { usage: { inputTokens: 9800 } } })
    expect(model.observeEvent('s1', { type: 'request/context', data: { provider: 'p', model: 'm' } })).toEqual({
      tokens: { ctx: '9.8k' },
    })
  })

  it('keeps the last occupancy across usage-less assistant messages and dedupes repeats', () => {
    const model = new SessionFactsModel()
    model.observeEvent('s1', { type: 'assistant/message', data: { usage: { inputTokens: 1000 } } })
    expect(model.observeEvent('s1', { type: 'assistant/message', data: { interrupted: true } })).toBeUndefined()
    expect(model.observeEvent('s1', { type: 'assistant/message', data: { usage: { inputTokens: 1000 } } })).toBeUndefined()
    expect(model.observeEvent('s1', { type: 'assistant/message', data: { usage: { inputTokens: 2000 } } })).toEqual({
      tokens: { ctx: '2.0k' },
    })
  })

  it('ignores other sessions and adopts the first observed session when none was tracked', () => {
    const model = new SessionFactsModel()
    model.setSession('s1')
    expect(
      model.observeEvent('child-1', { type: 'request/header', data: { header: { config: { model: 'child' } } } }),
    ).toBeUndefined()
    expect(model.desiredTokens()).toEqual({})

    const fresh = new SessionFactsModel()
    expect(fresh.observeEvent('s9', { type: 'assistant/message', data: { usage: { inputTokens: 500 } } })).toEqual({
      tokens: { ctx: '500' },
    })
    expect(
      fresh.observeEvent('other', { type: 'assistant/message', data: { usage: { inputTokens: 900 } } }),
    ).toBeUndefined()
  })

  it('keeps title behaviors: dedupe, re-publish after a session switch, blank ignored', () => {
    const model = new SessionFactsModel()
    const title = (t: string) => ({ type: 'session/title', data: { title: t } })
    expect(model.observeEvent('s1', title('t'))).toEqual({ title: 't' })
    expect(model.observeEvent('s1', title('t'))).toBeUndefined()
    expect(model.observeEvent('s1', title('   '))).toBeUndefined()
    expect(model.setSession('s2', { title: 't' })).toEqual({ title: 't' })
  })

  it('null-clears previously reported token keys when a new session does not know them', () => {
    const model = new SessionFactsModel()
    model.setSession('s1', { model: 'm1', contextWindow: 10000, usedTokens: 2000 })
    expect(model.setSession('s2')).toEqual({ tokens: { model: null, ctx: null } })

    const partial = new SessionFactsModel()
    partial.setSession('s1', { model: 'm1', contextWindow: 10000, usedTokens: 2000 })
    expect(partial.setSession('s3', { model: 'deepseek-chat' })).toEqual({
      tokens: { model: 'deepseek-chat', ctx: null },
    })
  })

  it('returns combined title and tokens from one session start', () => {
    const model = new SessionFactsModel()
    expect(model.setSession('s2', { title: 'T', model: 'm', usedTokens: 5, contextWindow: 10 })).toEqual({
      title: 'T',
      tokens: { model: 'm', ctx: '5/10' },
    })
  })
})
