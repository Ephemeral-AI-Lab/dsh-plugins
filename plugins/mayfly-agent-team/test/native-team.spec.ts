/** Team tools are admitted by exact preset identity, including after switches and recovery. */
import { afterEach, expect, it, vi } from 'vitest'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import * as plugin from '../src/index.ts'
import { teamMembership } from '../src/membership.ts'
import { fixture } from './fixture.ts'

const benches: Awaited<ReturnType<typeof fixture>>[] = []
afterEach(async () => { for (const bench of benches.splice(0)) await bench.dispose() })
const setup = async () => { const bench = await fixture(); benches.push(bench); return bench }
const names = ['spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update']

it('exposes no Team tools or policy to any ordinary preset, including pre-existing roots', async () => {
  const bench = await setup()
  await bench.fiber.dispose()
  const agents = await Promise.all(['standard', 'minimal', 'ptc', 'cordis', 'mayfly-cordis', 'team'].map(id => bench.create(id, id)))
  await bench.ctx.plugin(plugin)
  for (const agent of agents) {
    const team = agent.id === 'team'
    for (const name of names) expect(bench.ctx.tools.get(name, agent) !== undefined, `${agent.id}/${name}`).toBe(team)
    const prompt = await bench.ctx.systemPrompt.assemble({ scope: scopeOf(agent.ctx)! })
    expect(JSON.stringify(prompt).includes('Agent Teams is available')).toBe(team)
  }
  const root = agents.at(-1)!
  const workflow = await bench.create('workflow-before-descriptor', 'team', root)
  expect(bench.ctx.agentTeams.tryMembership(workflow)).toBeDefined()
  expect(teamMembership(bench.ctx, workflow)).toBeUndefined()
  for (const name of names) expect(bench.ctx.tools.get(name, workflow)).toBeUndefined()
  expect(teamMembership(bench.ctx, { ...root } as typeof root)).toBeUndefined()
})

it('adds and removes exact-Agent tools on blank preset changes and plugin unload', async () => {
  const bench = await setup()
  const agent = await bench.create('switcher')
  await bench.ctx.agentPresets.select(agent, 'team')
  expect(bench.ctx.tools.get('spawn_teammate', agent)).toBeDefined()
  await bench.ctx.agentPresets.select(agent, 'standard')
  for (const name of names) expect(bench.ctx.tools.get(name, agent)).toBeUndefined()
  await bench.ctx.agentPresets.select(agent, 'team')
  await bench.fiber.dispose()
  for (const name of names) expect(bench.ctx.tools.get(name, agent)).toBeUndefined()
  await bench.ctx.plugin(plugin)
  expect(bench.ctx.tools.get('spawn_teammate', agent)).toBeDefined()
})

it('waits without polling, preserves native interruption authority, and pages tasks', async () => {
  const bench = await setup()
  const lead = await bench.create('lead', 'team')
  expect(await bench.execute(lead, 'wait_agent', {})).toMatchObject({ noProgress: { reason: 'no-active-peer' } })
  await expect(bench.execute(lead, 'wait_agent', { timeout_ms: 1 })).rejects.toThrow()
  await bench.execute(lead, 'spawn_teammate', { name: 'reviewer', description: 'Review', prompt: 'Review' })
  const child = bench.ctx.agents.get(bench.ctx.agentTeams.listMembers(lead).find(member => member.name === 'reviewer')!.id)!
  await vi.waitFor(() => expect(child.status).toBe('running'))
  await expect(bench.execute(child, 'interrupt_agent', { target: 'lead' })).rejects.toThrow()
  const waiting = bench.execute(lead, 'wait_agent', { timeout_ms: 10000 })
  await new Promise(resolve => setImmediate(resolve))
  await bench.execute(lead, 'team_task_create', { subject: 'First', description: 'First task' })
  expect(await waiting).toMatchObject({ timedOut: false })
  await bench.execute(lead, 'team_task_create', { subject: 'Second', description: 'Second task' })
  expect(await bench.execute(lead, 'team_task_list', { owner: 'unowned', ready: true, limit: 1 })).toMatchObject({ nextCursor: 1 })
  expect((await bench.execute(lead, 'team_task_list', { cursor: 1, limit: 1 })).tasks).toHaveLength(1)
  await expect(bench.execute(lead, 'team_task_list', { cursor: -1 })).rejects.toThrow()
  await expect(bench.execute(lead, 'team_task_list', { limit: 101 })).rejects.toThrow()
  expect(await bench.execute(lead, 'interrupt_agent', { target: 'reviewer' })).toMatchObject({ previousStatus: 'running' })
})

it('uses native fresh/fork teammates, shared tasks, version checks, and retained continuation', async () => {
  const bench = await setup()
  const lead = await bench.create('lead', 'team')
  const spawned = await bench.execute(lead, 'spawn_teammate', { name: 'reviewer', description: 'Review', prompt: 'Review the change' })
  expect(spawned.member.target).toBe('reviewer')
  const member = bench.ctx.agentTeams.listMembers(lead).find(member => member.name === 'reviewer')!
  const child = bench.ctx.agents.get(member.id)!
  await vi.waitFor(() => expect(child.status).toBe('running'))
  for (const name of names) expect(bench.ctx.tools.get(name, child)).toBeDefined()
  expect(teamMembership(bench.ctx, child)?.root).toBe(lead)
  const task = await bench.execute(lead, 'team_task_create', { subject: 'Review', description: 'Check scopes', write_scopes: ['src/auth'] })
  const claimed = await bench.execute(child, 'team_task_update', { task_id: task.id, expected_revision: task.revision, action: 'claim' })
  expect(claimed.ownerName).toBe('reviewer')
  await expect(bench.execute(child, 'team_task_update', { task_id: task.id, expected_revision: task.revision, action: 'complete' })).rejects.toThrow()
  const completed = await bench.execute(child, 'team_task_update', { task_id: task.id, expected_revision: claimed.revision, action: 'complete' })
  expect(completed.status).toBe('completed')
  expect((await bench.execute(lead, 'team_task_list', { owner: 'reviewer', status: 'completed' })).tasks).toHaveLength(1)
  expect((await bench.execute(lead, 'team_task_get', { task_id: task.id })).revision).toBe(completed.revision)
  await expect(bench.execute(child, 'spawn_teammate', { name: 'nested', description: 'No nested teams', prompt: 'No' })).rejects.toThrow()
  const forked = await bench.execute(lead, 'spawn_teammate', { name: 'tester', description: 'Test', prompt: 'Run tests', context: 'fork' })
  expect(forked.member.context).toBe('fork')
  const receipt = await bench.execute(child, 'send_message', { target: 'lead', message: 'Review complete' })
  expect(['accepted', 'queued']).toContain(receipt.status)
  await vi.waitFor(() => expect(lead.status).toBe('running'))
  await bench.ctx.subagents.drainContinuableChildren(lead, [child.id])
  expect(bench.ctx.agents.get(child.id)).toBeUndefined()
  await bench.ctx.subagents.prompt({ requestId: 'resume-reviewer' as never, parentSessionId: lead.id, childSessionId: child.id, mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: 'Continue' }] }, new AbortController().signal)
  const resumed = bench.ctx.agents.get(child.id)!
  expect(resumed).not.toBe(child)
  expect(bench.ctx.tools.get('team_task_list', resumed)).toBeDefined()
  expect(teamMembership(bench.ctx, child)).toBeUndefined()
})
