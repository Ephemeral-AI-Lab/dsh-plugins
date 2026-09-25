/** Real native Team facts drive disposable public Mayfly contributions. */
import { afterEach, expect, it, vi } from 'vitest'
import Commands from '@deepseek-ai/dsh-commands'
import { MayflyCurrentAgentService } from '@ephemeral-ai/mayfly/app'
import { MayflyLocaleService } from '@ephemeral-ai/mayfly/frontend'
import * as uiProvider from '@ephemeral-ai/mayfly-ui/provider'
import type { MayflyOverlayEntry, MayflyUiEvent } from '@ephemeral-ai/mayfly-ui'
import { fixture } from './fixture.ts'

const benches: Awaited<ReturnType<typeof fixture>>[] = []
afterEach(async () => { for (const bench of benches.splice(0)) await bench.dispose() })
async function setup() {
  const bench = await fixture(); benches.push(bench)
  await bench.ctx.plugin(Commands)
  await bench.ctx.plugin(uiProvider)
  await bench.ctx.plugin({ inject: ['agents'], apply(ctx) { new MayflyCurrentAgentService(ctx); new MayflyLocaleService(ctx, { preference: 'zh' }) } })
  const ordinary = await bench.create('ordinary')
  const lead = await bench.create('lead', 'team')
  bench.ctx.mayflyCurrentAgent.select(ordinary)
  await vi.waitFor(() => expect(bench.ctx.commands.list(lead).some(command => command.name === 'team')).toBe(true))
  const fiber = bench.fiber
  const run = async () => {
    const result = await bench.ctx.commands.execute(bench.ctx.mayflyCurrentAgent.current()!, '/team', [], new AbortController().signal)
    expect(result).toMatchObject({ result: { kind: 'success' } })
    return result
  }
  const overlay = (id = 'agent-team.board') => {
    const entry = bench.ctx.mayflyOverlays.list().find(entry => entry.id === id)
    if (entry === undefined) throw new Error(`Missing overlay ${id}`)
    return entry
  }
  return { ...bench, ordinary, lead, tui: fiber, run, overlay }
}
async function action(entry: MayflyOverlayEntry, event: MayflyUiEvent) {
  const prepared = await entry.events.prepare(event, { surfaceId: entry.id, source: [], revision: entry.revision, operationId: 'test', signal: new AbortController().signal, report: vi.fn() })
  prepared.publish()
  return prepared.reply
}
const select = (controlId: string, id: string): MayflyUiEvent => ({ kind: 'selection-accept', pagePath: [], controlId, selectedIds: [id] })

it('keeps ordinary sessions clean and follows preset switches, locale and plugin disposal', async () => {
  const bench = await setup()
  expect(bench.ctx.commands.list(bench.ordinary).some(command => command.name === 'team')).toBe(false)
  expect(bench.ctx.mayflyStatus.list()).toHaveLength(0)
  expect(bench.ctx.mayflyEditorExtensions.list()).toHaveLength(0)
  bench.ctx.mayflyCurrentAgent.select(bench.lead)
  await bench.run()
  expect(JSON.stringify(bench.overlay().node)).toContain('还没有队友')
  expect(bench.ctx.mayflyStatus.list()).toHaveLength(1)
  bench.ctx.mayflyLocale.setPreference('en')
  expect(JSON.stringify(bench.overlay().node)).toContain('No teammates yet')
  await bench.ctx.agentPresets.select(bench.lead, 'standard')
  expect(bench.ctx.mayflyOverlays.list()).toHaveLength(0)
  expect(bench.ctx.mayflyStatus.list()).toHaveLength(0)
  expect(bench.ctx.commands.list(bench.lead).some(command => command.name === 'team')).toBe(false)
  await bench.ctx.agentPresets.select(bench.lead, 'team')
  await bench.run()
  await bench.tui.dispose()
  expect(bench.ctx.mayflyOverlays.list()).toHaveLength(0)
  expect(bench.ctx.mayflyStatus.list()).toHaveLength(0)
  expect(bench.ctx.mayflyEditorExtensions.list()).toHaveLength(0)
  expect(bench.ctx.commands.list(bench.lead).some(command => command.name === 'team')).toBe(false)
})

it('opens tasks and exact live/cold member views, without waking a browsed member', async () => {
  const bench = await setup()
  bench.ctx.mayflyCurrentAgent.select(bench.lead)
  await bench.execute(bench.lead, 'spawn_teammate', { name: 'reviewer', description: 'Review', prompt: 'Check the diff' })
  const member = bench.ctx.agentTeams.listMembers(bench.lead).find(member => member.name === 'reviewer')!
  const child = bench.ctx.agents.get(member.id)!
  const task = await bench.execute(bench.lead, 'team_task_create', { subject: 'Review scopes', description: 'Inspect the auth change', write_scopes: ['src/auth'] })
  const assigned = await bench.execute(bench.lead, 'team_task_update', { task_id: task.id, expected_revision: task.revision, action: 'reassign', owner: 'reviewer' })
  await bench.run()
  expect(JSON.stringify(bench.overlay().node)).toContain('Inspect the auth change')
  await bench.execute(bench.lead, 'team_task_update', { task_id: task.id, expected_revision: assigned.revision, action: 'edit', description: 'Updated native description' })
  expect(JSON.stringify(bench.overlay().node)).toContain('Updated native description')
  bench.publishFacts([{ id: member.id, phase: 'running', tokens: 2048, toolCount: 3, activity: 'Using read', model: 'mock-x' }])
  const board = JSON.stringify(bench.overlay().node)
  expect(board).toContain('Using read')
  expect(board).toContain('3 个工具')
  expect(board).toContain('2k tokens')
  await action(bench.overlay(), select('tasks', task.id))
  expect(bench.ctx.mayflyCurrentAgent.current()).toBe(child)
  expect(bench.ctx.mayflyOverlays.list()).toHaveLength(0)
  const replies: unknown[] = []
  bench.ctx.on('mayfly/request-subagent-reply', target => { replies.push(target) })
  const editor = bench.ctx.mayflyEditorExtensions.list()[0]!
  const prepared = await editor.events.prepare({ kind: 'activate', pagePath: [], controlId: 'actions', actionId: 'reply' }, { surfaceId: editor.id, source: [], revision: editor.revision, operationId: 'reply', signal: new AbortController().signal, report: vi.fn() })
  prepared.publish()
  expect(replies).toMatchObject([{ sessionId: child.id, parentSessionId: bench.lead.id }])
  bench.ctx.mayflyCurrentAgent.closeAuxiliary()
  await bench.ctx.subagents.drainContinuableChildren(bench.lead, [child.id])
  const prompt = vi.spyOn(bench.ctx.subagents, 'prompt')
  await bench.run()
  await action(bench.overlay(), select('members', member.id))
  expect(prompt).not.toHaveBeenCalled()
  expect(bench.ctx.mayflyCurrentAgent.view().auxiliary).toMatchObject({ sessionId: child.id, access: 'resumable' })
  expect(JSON.stringify(bench.ctx.mayflyEditorExtensions.list()[0]!.decoration)).toContain('回复并恢复')
  bench.ctx.mayflyCurrentAgent.select(bench.ordinary)
  expect(bench.ctx.mayflyEditorExtensions.list()).toHaveLength(0)
})

it('rejects stale targets and unowned tasks, and closes the board cleanly', async () => {
  const bench = await setup()
  bench.ctx.mayflyCurrentAgent.select(bench.lead)
  const task = await bench.execute(bench.lead, 'team_task_create', { subject: 'Read', description: 'Read only' })
  await bench.run()
  const entry = bench.overlay()
  expect(await action(entry, select('members', 'missing'))).toMatchObject({ kind: 'failed' })
  expect(await action(entry, select('tasks', 'missing'))).toMatchObject({ kind: 'failed' })
  expect(await action(entry, select('tasks', task.id))).toMatchObject({ kind: 'failed' })
  bench.ctx.mayflyOverlays.close('agent-team.board')
  expect(bench.ctx.mayflyOverlays.list()).toHaveLength(0)
  await bench.run()
  const stale = bench.overlay()
  bench.ctx.mayflyCurrentAgent.select(bench.ordinary)
  expect(await action(stale, select('members', bench.lead.id))).toBeUndefined()
  expect(bench.ctx.mayflyCurrentAgent.current()).toBe(bench.ordinary)
})
