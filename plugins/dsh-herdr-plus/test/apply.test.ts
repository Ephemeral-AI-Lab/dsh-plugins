import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apply, Config } from '../src/index.js'

interface FakeService {
  register?: (def: { name: string }) => () => void
  registerProvider?: (create: () => { name: string }) => () => void
}

let dir: string
let savedEnv: Record<string, string | undefined>

const HERDR_ENV_KEYS = ['HERDR_ENV', 'HERDR_SOCKET_PATH', 'HERDR_PANE_ID', 'HERDR_BIN_PATH'] as const

function makeCtx(services: Record<string, FakeService | undefined>) {
  const disposers: Array<() => void> = []
  const ctx = {
    get(name: string) { return services[name] },
    on() { return () => {} },
    effect(fn: () => () => void, _label?: string) {
      disposers.push(fn())
      return () => {}
    },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }
  return { ctx, disposers }
}

function skillsService() {
  const registered: Array<{ name: string }> = []
  return {
    registered,
    registerProvider(create: () => { name: string }) {
      registered.push(create())
      return () => {}
    },
  }
}

function toolsService() {
  const registered: string[] = []
  return {
    registered,
    register(def: { name: string }) {
      registered.push(def.name)
      return () => {}
    },
  }
}

async function waitForTools(tools: { registered: string[] }): Promise<void> {
  // The tools module is loaded via `void import()` inside apply.
  await vi.waitFor(() => expect(tools.registered.length).toBeGreaterThan(0), { timeout: 5_000, interval: 20 })
}

/** Give the (non-)registration path a beat to settle before asserting absence. */
async function settleDynamicImport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'herdr-apply-'))
  savedEnv = Object.fromEntries(HERDR_ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.HERDR_ENV = '1'
  process.env.HERDR_SOCKET_PATH = join(dir, 'missing.sock')
  process.env.HERDR_PANE_ID = 'w0:p0'
  delete process.env.HERDR_BIN_PATH
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('apply gates', () => {
  it('registers the skill provider and tools inside a Herdr pane', async () => {
    const skills = skillsService()
    const tools = toolsService()
    const { ctx } = makeCtx({ skills, tools })
    apply(ctx as never, Config({}))
    await waitForTools(tools)
    expect(skills.registered.map((p) => p.name)).toEqual(['dsh-herdr-plus'])
    expect(tools.registered.sort()).toEqual([
      'herdr_agent_prompt', 'herdr_agent_read', 'herdr_agent_spawn', 'herdr_agent_wait',
    ])
  })

  it('keeps report-only mode when skill and tools are none', async () => {
    const skills = skillsService()
    const tools = toolsService()
    const { ctx } = makeCtx({ skills, tools })
    apply(ctx as never, Config({ skill: 'none', tools: 'none' }))
    await settleDynamicImport()
    expect(skills.registered).toHaveLength(0)
    expect(tools.registered).toHaveLength(0)
  })

  it('still registers the skill when the tools service is absent', async () => {
    const skills = skillsService()
    const { ctx } = makeCtx({ skills })
    apply(ctx as never, Config({}))
    await new Promise((resolve) => setImmediate(resolve))
    expect(skills.registered).toHaveLength(1)
  })

  it('is a strict no-op outside a Herdr pane', async () => {
    delete process.env.HERDR_ENV
    const skills = skillsService()
    const tools = toolsService()
    const { ctx } = makeCtx({ skills, tools })
    apply(ctx as never, Config({}))
    await settleDynamicImport()
    expect(skills.registered).toHaveLength(0)
    expect(tools.registered).toHaveLength(0)
  })

  it('rejects the unimplemented cli transport at load', () => {
    const { ctx } = makeCtx({})
    expect(() => apply(ctx as never, Config({ transport: 'cli' }))).toThrow(/not implemented/)
  })
})
