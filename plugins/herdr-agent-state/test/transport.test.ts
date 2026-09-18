import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HerdrReporter, herdrEnabled, sendRequest, socketEndpoint } from '../src/transport.js'

interface CapturedRequest {
  id?: string
  method?: string
  params?: Record<string, any>
}

interface FakeServer {
  requests: CapturedRequest[]
  socketPath: string
  close(): Promise<void>
}

let active: FakeServer | undefined
let activeNet: net.Server | undefined
let dir: string

function startServer(): Promise<FakeServer> {
  dir = mkdtempSync(join(tmpdir(), 'herdr-state-'))
  const socketPath = join(dir, 'herdr.sock')
  const requests: CapturedRequest[] = []
  const srv = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) requests.push(JSON.parse(line) as CapturedRequest)
      }
      socket.end()
    })
  })
  return new Promise((resolve) => {
    srv.listen(socketPath, () => {
      activeNet = srv
      active = {
        requests,
        socketPath,
        close: () =>
          new Promise<void>((done) => {
            srv.close(() => {
              rmSync(dir, { recursive: true, force: true })
              done()
            })
          }),
      }
      resolve(active)
    })
  })
}

function env(paneId = 'p1'): Record<string, string> {
  return { HERDR_ENV: '1', HERDR_SOCKET_PATH: active!.socketPath, HERDR_PANE_ID: paneId }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  active = undefined
  activeNet = undefined
})

afterEach(async () => {
  if (activeNet) {
    await new Promise<void>((done) => activeNet!.close(() => done()))
  }
  if (active) {
    rmSync(active.socketPath, { force: true })
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('herdrEnabled / socketEndpoint', () => {
  it('enables only when the full Herdr env is present', () => {
    expect(herdrEnabled({})).toBe(false)
    expect(herdrEnabled({ HERDR_ENV: '1' })).toBe(false)
    expect(herdrEnabled({ HERDR_ENV: '1', HERDR_SOCKET_PATH: '/x' })).toBe(false)
    expect(herdrEnabled({ HERDR_ENV: '1', HERDR_SOCKET_PATH: '/x', HERDR_PANE_ID: 'p' })).toBe(true)
  })

  it('maps Windows named pipes on Windows', () => {
    if (process.platform === 'win32') {
      expect(socketEndpoint({ HERDR_SOCKET_PATH: 'foo' })).toBe('\\\\.\\pipe\\foo')
    } else {
      expect(socketEndpoint({ HERDR_SOCKET_PATH: '/x/herdr.sock' })).toBe('/x/herdr.sock')
    }
  })
})

describe('sendRequest', () => {
  it('delivers a newline-delimited JSON line and resolves true', async () => {
    await startServer()
    const request = { id: 'r1', method: 'pane.report_agent', params: { pane_id: 'p1' } }
    const delivered = await sendRequest(request, active!.socketPath)
    expect(delivered).toBe(true)
    await delay(10)
    expect(active!.requests).toHaveLength(1)
    expect(active!.requests[0]).toMatchObject({ method: 'pane.report_agent', params: { pane_id: 'p1' } })
  })

  it('resolves false (never throws) when Herdr is unreachable', async () => {
    const delivered = await sendRequest(
      { id: 'r1', method: 'pane.release_agent', params: {} },
      join(tmpdir(), 'nonexistent-herdr.sock'),
    )
    expect(delivered).toBe(false)
  })
})

describe('HerdrReporter', () => {
  it('publishes state with seq and session ref, coalescing bursts to the latest', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 'herdr:dsh-agent-state',
      agent: 'dsh',
      reportSession: true,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.setSessionId('sess-123')

    reporter.publishState({ state: 'working' })
    reporter.publishState({ state: 'blocked', message: 'fs:write' })
    reporter.publishState({ state: 'idle' })

    await delay(30)
    const states = active!.requests.filter((r) => r.method === 'pane.report_agent')
    expect(states.length).toBeGreaterThanOrEqual(1)
    expect(states.length).toBeLessThanOrEqual(2)
    const last = states[states.length - 1]!
    expect(last.params).toMatchObject({
      pane_id: 'p1',
      source: 'herdr:dsh-agent-state',
      agent: 'dsh',
      state: 'idle',
      agent_session_id: 'sess-123',
    })
    expect(typeof last.params?.seq).toBe('number')
  })

  it('keeps seq strictly increasing across reports', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.publishState({ state: 'working' })
    await delay(10)
    reporter.publishState({ state: 'idle' })
    await delay(10)
    const seqs = active!.requests.map((r) => r.params?.seq as number)
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)
    }
  })

  it('reports the session reference with its start source', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'blue',
      reportSession: true,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.setSessionId('sess-9')
    reporter.reportSession('resume')
    await delay(10)
    const sessionReport = active!.requests.find((r) => r.method === 'pane.report_agent_session')
    expect(sessionReport?.params).toMatchObject({
      pane_id: 'p1',
      source: 's',
      agent: 'blue',
      agent_session_id: 'sess-9',
      session_start_source: 'resume',
    })
  })

  it('releases pane authority', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: true,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.release()
    await delay(10)
    const releaseReport = active!.requests.find((r) => r.method === 'pane.release_agent')
    expect(releaseReport?.params).toMatchObject({ pane_id: 'p1', source: 's', agent: 'dsh' })
    expect(active!.requests.filter((r) => r.method === 'pane.report_metadata')).toHaveLength(0)
  })

  it('omits the session ref when reportSession is disabled', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.setSessionId('sess-1')
    reporter.publishState({ state: 'working' })
    await delay(10)
    const last = active!.requests[active!.requests.length - 1]!
    expect(last.params).not.toHaveProperty('agent_session_id')
  })

  it('reports a working message and the session path on report_agent', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: true,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.setSessionId('sess-1')
    reporter.setSessionPath('/abs/session.jsonl.zstd')
    reporter.publishState({ state: 'working', message: 'fs:read' })
    await delay(10)
    const last = active!.requests.find((r) => r.method === 'pane.report_agent')!
    expect(last.params).toMatchObject({
      state: 'working',
      message: 'fs:read',
      agent_session_id: 'sess-1',
      agent_session_path: '/abs/session.jsonl.zstd',
    })
  })

  it('attaches the session path to report_agent_session and omits it when unset', async () => {
    await startServer()
    const withPath = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: true,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    withPath.setSessionId('sess-1')
    withPath.setSessionPath('/abs/session.jsonl.zstd')
    withPath.reportSession('startup')
    await delay(10)
    expect(active!.requests.find((r) => r.method === 'pane.report_agent_session')?.params).toMatchObject({
      agent_session_id: 'sess-1',
      agent_session_path: '/abs/session.jsonl.zstd',
    })

    await startServer()
    const withoutPath = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: true,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    withoutPath.setSessionId('sess-2')
    withoutPath.reportSession('startup')
    await delay(10)
    const params = active!.requests.find((r) => r.method === 'pane.report_agent_session')?.params
    expect(params).toMatchObject({ agent_session_id: 'sess-2' })
    expect(params).not.toHaveProperty('agent_session_path')
  })

  it('coalesces working messages latest-wins', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.publishState({ state: 'working', message: 'fs:read' })
    reporter.publishState({ state: 'working', message: 'fs:edit' })
    await delay(10)
    const states = active!.requests.filter((r) => r.method === 'pane.report_agent')
    expect(states.length).toBeLessThanOrEqual(2)
    expect(states[states.length - 1]!.params).toMatchObject({ state: 'working', message: 'fs:edit' })
  })

  it('reports the title via pane.report_metadata with guards', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: false,
      env: env(),
    })
    reporter.reportMetadata({ title: 'Fix login' })
    await delay(10)
    const metadata = active!.requests.find((r) => r.method === 'pane.report_metadata')
    expect(metadata?.params).toMatchObject({
      pane_id: 'p1',
      source: 's',
      agent: 'dsh',
      applies_to_source: 's',
      title: 'Fix login',
    })
    expect(typeof metadata?.params?.seq).toBe('number')
  })

  it('reports tokens without the presentation guards', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: true,
      env: env(),
    })
    reporter.reportMetadata({ tokens: { model: 'deepseek-chat', ctx: '34k/1.0M' } })
    await delay(10)
    const metadata = active!.requests.find((r) => r.method === 'pane.report_metadata')!
    expect(metadata.params).toMatchObject({
      pane_id: 'p1',
      source: 's',
      tokens: { model: 'deepseek-chat', ctx: '34k/1.0M' },
    })
    expect(metadata.params).not.toHaveProperty('agent')
    expect(metadata.params).not.toHaveProperty('applies_to_source')
    expect(typeof metadata.params?.seq).toBe('number')
  })

  it('combines title, tokens, and state labels into one guarded request', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: true,
      env: env(),
    })
    reporter.reportMetadata({ title: 'T', tokens: { model: 'm', ctx: '1k' }, state_labels: { working: 'RUN' } })
    await delay(10)
    const metas = active!.requests.filter((r) => r.method === 'pane.report_metadata')
    expect(metas).toHaveLength(1)
    expect(metas[0]!.params).toMatchObject({
      title: 'T',
      tokens: { model: 'm', ctx: '1k' },
      state_labels: { working: 'RUN' },
      agent: 'dsh',
      applies_to_source: 's',
    })
  })

  it('reports state labels on their own with guards', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.reportMetadata({ state_labels: { blocked: '等确认' } })
    await delay(10)
    expect(active!.requests.find((r) => r.method === 'pane.report_metadata')?.params).toMatchObject({
      state_labels: { blocked: '等确认' },
      agent: 'dsh',
      applies_to_source: 's',
    })
  })

  it('dedupes per kind and sends only the changed kinds', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: true,
      env: env(),
    })
    reporter.reportMetadata({ title: 'T' })
    reporter.reportMetadata({ title: 'T' })
    reporter.reportMetadata({ tokens: { ctx: '1k' } })
    await delay(10)
    const metas = active!.requests.filter((r) => r.method === 'pane.report_metadata')
    expect(metas).toHaveLength(2)
    expect(metas[0]!.params).toMatchObject({ title: 'T' })
    expect(metas[0]!.params).not.toHaveProperty('tokens')
    expect(metas[1]!.params).toMatchObject({ tokens: { ctx: '1k' } })
    expect(metas[1]!.params).not.toHaveProperty('title')
  })

  it('sends nothing for empty titles, empty objects, or undefined fields', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: true,
      env: env(),
    })
    reporter.reportMetadata({ title: '' })
    reporter.reportMetadata({ title: '   ' })
    reporter.reportMetadata({ title: undefined })
    reporter.reportMetadata({})
    reporter.reportMetadata({ tokens: {} })
    reporter.reportMetadata({ state_labels: {} })
    reporter.reportMetadata(undefined)
    await delay(10)
    expect(active!.requests.filter((r) => r.method === 'pane.report_metadata')).toHaveLength(0)
  })

  it('no-ops disabled kinds (state labels are simply never passed when unconfigured)', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: false,
      env: env(),
    })
    reporter.reportMetadata({ title: 'T', tokens: { model: 'm' } })
    await delay(10)
    expect(active!.requests.filter((r) => r.method === 'pane.report_metadata')).toHaveLength(0)
  })

  it('clears everything sent in one combined request on release, once', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: true,
      env: env(),
    })
    reporter.reportMetadata({ title: 'T', tokens: { model: 'm', ctx: '1k' }, state_labels: { working: 'RUN' } })
    await delay(10)
    reporter.release()
    reporter.release()
    await delay(10)
    const clears = active!.requests.filter(
      (r) => r.method === 'pane.report_metadata' && !('title' in (r.params as object)),
    )
    expect(clears).toHaveLength(1)
    expect(clears[0]!.params).toMatchObject({
      pane_id: 'p1',
      source: 's',
      clear_title: true,
      clear_state_labels: true,
      tokens: { model: null, ctx: null },
    })
    expect(typeof clears[0]!.params?.seq).toBe('number')
    expect(active!.requests.find((r) => r.method === 'pane.release_agent')).toBeTruthy()
  })

  it('clears only the kinds that were sent', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: false,
      reportTokens: true,
      env: env(),
    })
    reporter.reportMetadata({ tokens: { ctx: '1k' } })
    await delay(10)
    reporter.release()
    await delay(10)
    const clear = active!.requests.find(
      (r) => r.method === 'pane.report_metadata' && r.params?.tokens?.ctx === null,
    )
    expect(clear).toBeTruthy()
    expect(clear!.params).toMatchObject({ tokens: { ctx: null } })
    expect(clear!.params).not.toHaveProperty('clear_title')
    expect(clear!.params).not.toHaveProperty('clear_state_labels')
  })

  it('sends no metadata clear when nothing was ever sent', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: true,
      env: env(),
    })
    reporter.release()
    await delay(10)
    expect(active!.requests.filter((r) => r.method === 'pane.report_metadata')).toHaveLength(0)
    expect(active!.requests.find((r) => r.method === 'pane.release_agent')).toBeTruthy()
  })

  it('keeps seq strictly increasing across report_agent and report_metadata', async () => {
    await startServer()
    const reporter = new HerdrReporter({
      source: 's',
      agent: 'dsh',
      reportSession: false,
      reportTitle: true,
      reportTokens: true,
      env: env(),
    })
    reporter.publishState({ state: 'working' })
    await delay(10)
    reporter.reportMetadata({ title: 't', tokens: { model: 'm' } })
    await delay(10)
    reporter.publishState({ state: 'idle' })
    await delay(10)
    reporter.release()
    await delay(10)
    const seqs = active!.requests
      .filter((r) => r.params?.seq !== undefined)
      .map((r) => r.params?.seq as number)
    expect(seqs.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)
    }
  })
})
