import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { registerHerdrTools } from '../src/tools.js'

const FAKE_HERDR = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_HERDR_LOG:?}"
counter_file="\${FAKE_HERDR_LOG}.agents"
case "$1 $2" in
  "pane split")
    echo '{"id":"x","result":{"type":"pane_info","pane":{"pane_id":"w9:p1","cwd":"/tmp"}}}' ;;
  "pane get")
    echo "{\\"id\\":\\"x\\",\\"result\\":{\\"type\\":\\"pane_info\\",\\"pane\\":{\\"pane_id\\":\\"$3\\"}}}" ;;
  "pane read")
    printf 'prompt> %s\\n' "\${FAKE_READ_TEXT:-ready}" ;;
  "pane run"|"pane send-text"|"pane send-keys")
    exit 0 ;;
  "agent get")
    n=0; [ -f "$counter_file" ] && n=$(cat "$counter_file")
    if [ "$n" -lt "\${FAKE_AGENT_AFTER:-0}" ]; then
      echo $((n+1)) > "$counter_file"
      echo '{"error":{"code":"agent_not_found","message":"not yet"},"id":"x"}' >&2; exit 1
    fi
    echo "{\\"id\\":\\"x\\",\\"result\\":{\\"type\\":\\"agent_info\\",\\"agent\\":{\\"pane_id\\":\\"w9:p1\\",\\"agent\\":\\"dsh\\",\\"agent_status\\":\\"\${FAKE_AGENT_STATUS:-idle}\\"}}}" ;;
  "agent rename") echo '{"id":"x","result":{"type":"ok"}}' ;;
  "agent wait")
    if [ "\${FAKE_WAIT_TIMEOUT:-0}" = 1 ]; then
      echo '{"error":{"code":"timeout","message":"timed out"},"id":"x"}' >&2; exit 1
    fi
    echo "{\\"id\\":\\"x\\",\\"result\\":{\\"type\\":\\"agent_info\\",\\"agent\\":{\\"pane_id\\":\\"w9:p1\\",\\"agent_status\\":\\"\${FAKE_WAIT_STATUS:-idle}\\"}}}" ;;
  *) echo "unhandled: $*" >&2; exit 1 ;;
esac
`

let dir: string
let log: string
let defs: ToolDefinition[]
let restore: () => void

function env(): Record<string, string> {
  return { HERDR_BIN_PATH: join(dir, 'herdr') }
}

function exec(agent?: unknown): ToolRunContext {
  return { signal: new AbortController().signal, agent } as unknown as ToolRunContext
}

function tool(name: string): ToolDefinition {
  const found = defs.find((d) => d.name === name)
  if (found === undefined) throw new Error(`tool ${name} not registered`)
  return found
}

function calls(): string[] {
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'herdr-tools-'))
  log = join(dir, 'calls.log')
  writeFileSync(join(dir, 'herdr'), FAKE_HERDR, { mode: 0o755 })
  process.env.FAKE_HERDR_LOG = log
  delete process.env.FAKE_AGENT_AFTER
  delete process.env.FAKE_AGENT_STATUS
  delete process.env.FAKE_WAIT_TIMEOUT
  delete process.env.FAKE_WAIT_STATUS
  delete process.env.FAKE_READ_TEXT
  defs = []
  const fakeTools = {
    register(definition: ToolDefinition) {
      defs.push(definition)
      return () => { defs = defs.filter((d) => d !== definition) }
    },
  }
  restore = registerHerdrTools(fakeTools as never, env(), { launchCommand: 'mayfly' })
})

afterEach(() => {
  restore()
  rmSync(dir, { recursive: true, force: true })
})

describe('registerHerdrTools', () => {
  it('registers the four orchestration tools and disposes them', () => {
    expect(defs.map((d) => d.name).sort()).toEqual([
      'herdr_agent_prompt', 'herdr_agent_read', 'herdr_agent_spawn', 'herdr_agent_wait',
    ])
    restore()
    expect(defs).toHaveLength(0)
  })
})

describe('herdr_agent_spawn', () => {
  it('splits, launches with a quoted task, waits for registration, renames', async () => {
    process.env.FAKE_AGENT_AFTER = '1'
    const out = await tool('herdr_agent_spawn').execute(
      { task: "review the diff, it's risky", name: 'reviewer', cwd: '/work/proj' },
      exec(),
    ) as Record<string, unknown>

    expect(out).toMatchObject({
      pane_id: 'w9:p1', registered: true, agent: 'dsh', agent_status: 'idle', name: 'reviewer',
    })
    expect(calls()).toEqual([
      'pane split --current --direction right --cwd /work/proj --no-focus',
      'pane read w9:p1 --source visible --lines 5',
      `pane run w9:p1 mayfly 'review the diff, it'"'"'s risky'`,
      'agent get w9:p1',
      'agent get w9:p1',
      'agent rename w9:p1 reviewer',
    ])
  })

  it('defaults cwd to the calling session header cwd', async () => {
    await tool('herdr_agent_spawn').execute({ task: 'x' }, exec({ session: { header: { cwd: '/sess/cwd' } } }))
    expect(calls()[0]).toContain('--cwd /sess/cwd')
  })

  it('launches the bare command when no task is given', async () => {
    const out = await tool('herdr_agent_spawn').execute({}, exec()) as Record<string, unknown>
    expect(out).toMatchObject({ pane_id: 'w9:p1', registered: true })
    expect(calls()).toContain('pane run w9:p1 mayfly')
  })

  it('returns registered=false when the sibling never reports', async () => {
    process.env.FAKE_AGENT_AFTER = '999'
    restore()
    const fakeTools = {
      register(definition: ToolDefinition) {
        defs.push(definition)
        return () => { defs = defs.filter((d) => d !== definition) }
      },
    }
    restore = registerHerdrTools(fakeTools as never, env(), {
      launchCommand: 'mayfly',
      agentReadyTimeoutMs: 800,
    })
    const out = await tool('herdr_agent_spawn').execute(
      { task: 'x' }, exec(),
    ) as Record<string, unknown>
    expect(out).toMatchObject({ pane_id: 'w9:p1', registered: false })
    expect(calls()).not.toContain('agent rename w9:p1 reviewer')
  })

  it('rejects malformed arguments', async () => {
    await expect(tool('herdr_agent_spawn').execute({ task: 5 }, exec())).rejects.toThrow(/invalid arguments/)
  })
})

describe('herdr_agent_prompt', () => {
  it('types text and submits enter', async () => {
    const out = await tool('herdr_agent_prompt').execute(
      { target: 'worker', text: 'also check tests' }, exec(),
    ) as Record<string, unknown>
    expect(out).toEqual({ sent: true, pane_id: 'w9:p1' })
    expect(calls()).toEqual([
      'agent get worker',
      'pane send-text w9:p1 also check tests',
      'pane send-keys w9:p1 enter',
    ])
  })

  it('refuses while the target is blocked', async () => {
    process.env.FAKE_AGENT_STATUS = 'blocked'
    await expect(
      tool('herdr_agent_prompt').execute({ target: 'worker', text: 'go' }, exec()),
    ).rejects.toThrow(/blocked/)
    expect(calls()).toEqual(['agent get worker'])
  })

  it('waits for settle when wait=true', async () => {
    process.env.FAKE_WAIT_STATUS = 'idle'
    const out = await tool('herdr_agent_prompt').execute(
      { target: 'worker', text: 'go', wait: true, timeout_ms: 5000 }, exec(),
    ) as Record<string, unknown>
    expect(out).toMatchObject({ sent: true, pane_id: 'w9:p1', status: 'idle' })
    expect(calls()).toContain('agent wait worker --timeout 5000')
  })
})

describe('herdr_agent_wait', () => {
  it('returns the matched status', async () => {
    process.env.FAKE_WAIT_STATUS = 'idle'
    const out = await tool('herdr_agent_wait').execute(
      { target: 'w9:p1', until: ['idle', 'blocked'], timeout_ms: 3000 }, exec(),
    ) as Record<string, unknown>
    expect(out).toEqual({ status: 'idle', matched: true })
    expect(calls()).toEqual(['agent wait w9:p1 --until idle --until blocked --timeout 3000'])
  })

  it('maps herdr timeouts to a structured miss', async () => {
    process.env.FAKE_WAIT_TIMEOUT = '1'
    const out = await tool('herdr_agent_wait').execute({ target: 'w9:p1' }, exec()) as Record<string, unknown>
    expect(out).toEqual({ status: 'timeout', matched: false })
    expect(calls()).toEqual(['agent wait w9:p1 --timeout 120000'])
  })
})

describe('herdr_agent_read', () => {
  it('resolves agent targets and returns pane content', async () => {
    process.env.FAKE_READ_TEXT = 'session output here'
    const out = await tool('herdr_agent_read').execute(
      { target: 'worker', lines: 40 }, exec(),
    ) as Record<string, unknown>
    expect(out).toMatchObject({ pane_id: 'w9:p1', source: 'recent-unwrapped' })
    expect(String(out.content)).toContain('session output here')
    expect(calls()).toEqual([
      'agent get worker',
      'pane read w9:p1 --source recent-unwrapped --lines 40',
    ])
  })

  it('falls back to the bare pane when the target is a pane id without an agent', async () => {
    process.env.FAKE_AGENT_AFTER = '99'
    const out = await tool('herdr_agent_read').execute({ target: 'w9:p2' }, exec()) as Record<string, unknown>
    expect(out).toMatchObject({ pane_id: 'w9:p2' })
    expect(calls()).toEqual([
      'agent get w9:p2',
      'pane get w9:p2',
      'pane read w9:p2 --source recent-unwrapped --lines 120',
    ])
  })
})
