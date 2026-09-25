/** External consumers exercise the built Mayfly compiler at hostile terminal widths. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { compileMayflyUiNode, MayflyComponentsService, visibleWidth, type MayflySemanticColors } from '@ephemeral-ai/mayfly/core'
import type { TeamProjection, TeamTaskView } from '@deepseek-ai/dsh-experimental-agent-team/client'
import { teamNode } from '../src/model.ts'

const long = '认证失败 👨‍👩‍👧‍👦 é ' + 'unbroken'.repeat(25)
const t = (key: string, values?: Readonly<Record<string, string | number>>) => key.replace(/\{([^}]+)\}/g, (_, name) => String(values?.[name] ?? name))
const task = (id: string, status: TeamTaskView['status'], ready: boolean): TeamTaskView => ({ id: id as never, revision: 1, subject: long, description: long.repeat(3), status, ready, ownerName: long, blockedBy: ['task-0' as never], writeScopes: ['src/' + long], writeScopeWarnings: [long] })
const team: TeamProjection = {
  failure: long,
  members: [
    { id: 'lead' as never, name: long, role: 'lead', phase: 'active' },
    { id: 'reviewer' as never, name: long, role: 'teammate', phase: 'active' },
    { id: 'cold' as never, name: long, role: 'teammate', phase: 'active' },
    { id: 'provisioning' as never, name: long, role: 'teammate', phase: 'provisioning' },
    { id: 'failed' as never, name: long, role: 'teammate', phase: 'failed', error: long },
  ],
  tasks: [task('ready', 'pending', true), task('blocked', 'pending', false), task('running', 'in_progress', false), task('done', 'completed', false)],
}

it('fits roster, empty and loading rows at 1–160 columns through the public renderer', async () => {
  const ctx = new Context()
  const identity = (text: string) => text
  const colors = new Proxy({ logoGradient: [identity] }, { get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity }) as MayflySemanticColors
  const components = new MayflyComponentsService(ctx, { theme: { colors }, tui: { requestRender() {} } } as never)
  const activity = new Map([
    ['lead', { loaded: true }],
    ['reviewer', { loaded: true, running: true, model: long, effort: long, activity: long, liveChars: 1234, tokens: 2048, toolCount: 3 }],
    ['cold', { loaded: false, tokens: 512, toolCount: 1, activity: long }],
  ])
  const nodes = [teamNode(team, 'lead', activity, t), teamNode(undefined, '', activity, t), teamNode({ members: team.members.slice(0, 1), tasks: [] }, 'lead', activity, t)]
  try {
    for (const node of nodes) for (const width of [1, 2, 8, 20, 40, 80, 100, 160]) {
      const result = compileMayflyUiNode(node, { components, colors, getViewport: () => ({ columns: width, rows: 30 }), screenMode: 'alternate', emit() {} })
      if (!result.ok) throw new Error(result.message)
      for (const row of result.value.component.render(width)) expect(visibleWidth(row), `width ${width}: ${row}`).toBeLessThanOrEqual(width)
    }
  } finally { await ctx.fiber.dispose() }
})
