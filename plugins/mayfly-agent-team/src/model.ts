/** Readonly Team projections rendered through ordinary Mayfly UI nodes. @module dsh-mayfly-agent-team/model */
import type { TeamProjection, TeamTaskView } from '@deepseek-ai/dsh-experimental-agent-team/client'
import { ui, type MayflyUiNode } from '@ephemeral-ai/mayfly-ui'
import type { MayflyTranslate } from '@ephemeral-ai/mayfly/frontend'

export interface MemberActivity { readonly running: boolean, readonly model?: string }
const NARROW = { maxWidth: 91 } as const

export function taskState(task: TeamTaskView, t: MayflyTranslate): string {
  return t(task.status === 'pending' ? task.ready ? 'Ready' : 'Blocked' : task.status === 'in_progress' ? 'In progress' : 'Completed')
}

export function teamNode(team: TeamProjection | undefined, current: string, activity: ReadonlyMap<string, MemberActivity>, t: MayflyTranslate): MayflyUiNode {
  if (team === undefined) return ui.loader({ message: t('Loading Team…') })
  const people = ui.list({ id: 'members', role: 'browse', filterable: true, selectedIds: [], items: team.members.map(member => {
    const live = activity.get(member.id)
    const phase = member.phase === 'active' ? live === undefined ? 'Not loaded' : live.running ? 'Running' : 'Inactive' : member.phase === 'failed' ? 'Failed' : 'Provisioning'
    return {
      id: member.id, label: member.name,
      badge: member.id === current ? t('Current chat') : t(member.role === 'lead' ? 'Lead' : 'Teammate'),
      disabled: member.id === current || member.phase !== 'active',
      detail: [t(phase), live?.model, member.error].filter(Boolean).join(' · '),
    }
  }) })
  const tasks = ui.list({ id: 'tasks', role: 'browse', filterable: true, selectedIds: [], items: team.tasks.map(task => ({
    id: task.id, label: `${task.id} · ${task.subject}`, badge: taskState(task, t),
    detail: [task.description.replace(/\s+/gu, ' '), task.ownerName ?? t('Unowned'), task.blockedBy.length ? `${t('Blocked by')}: ${task.blockedBy.join(', ')}` : '', task.writeScopeWarnings.length ? t('Write scopes overlap') : ''].filter(Boolean).join(' · '),
    searchText: `${task.id} ${task.subject} ${task.description} ${task.ownerName ?? ''}`,
  })), empty: ui.empty({ title: t('No shared tasks'), description: t('Create and update tasks through the conversation.') }) })
  const warnings = team.tasks.filter(task => task.writeScopeWarnings.length > 0)
  return ui.surface({ title: t('Agent Team'), chrome: 'overlay', child: ui.stack.column([
    ...(team.failure === undefined ? [] : [ui.text(team.failure, { tone: 'danger' })]),
    ui.text(t('{members} members · {tasks} unfinished tasks', { members: team.members.length, tasks: team.tasks.filter(task => task.status !== 'completed').length })),
    ...(warnings.length ? [ui.text(`${t('Write scopes overlap')}: ${warnings.map(task => task.id).join(', ')}`, { tone: 'warning' })] : []),
    ...(team.members.length === 1 ? [ui.empty({ title: t('No teammates yet'), description: t('Ask the Lead explicitly to use Agent Team and delegate work.') })] : []),
    ui.tabs({ id: 'team-pages', activeId: 'members', items: [{ id: 'members', label: t('Members'), count: team.members.length }, { id: 'tasks', label: t('Shared tasks'), count: team.tasks.length }] }),
    ui.stack.row([
      ui.child(people, { tab: { controlId: 'team-pages', itemId: 'members' }, tabWhen: NARROW, basis: 0, grow: 1, minSize: 0 }),
      ui.child(tasks, { tab: { controlId: 'team-pages', itemId: 'tasks' }, tabWhen: NARROW, basis: 0, grow: 2, minSize: 0 }),
    ], { gap: 1 }),
    ui.actions({ id: 'team-actions', items: [{ id: 'close', label: t('Back to conversation'), dismiss: true }] }),
  ], { gap: 1 }) })
}
