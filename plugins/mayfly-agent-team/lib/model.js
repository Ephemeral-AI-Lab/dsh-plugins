import { ui } from '@ephemeral-ai/mayfly-ui';
export function taskState(task, t) {
    return t(task.status === 'pending' ? task.ready ? 'Ready' : 'Blocked' : task.status === 'in_progress' ? 'In progress' : 'Completed');
}
const trimDecimal = (value) => value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
const formatCount = (count) => !Number.isFinite(count) || count < 0 ? '0'
    : count >= 1024 * 1024 ? `${trimDecimal(count / (1024 * 1024))}M`
        : count >= 1024 ? `${trimDecimal(count / 1024)}k` : String(count);
function memberPhase(member, live, t) {
    if (member.phase === 'failed')
        return t('Failed');
    if (member.phase !== 'active')
        return t('Provisioning');
    if (live === undefined)
        return t('Not loaded');
    if (live.running)
        return t('Running');
    if (live.waiting)
        return t('Waiting');
    return t('Inactive');
}
function liveMetrics(live, t, model = true) {
    if (live === undefined)
        return [];
    return [
        ...(model ? [live.model, live.effort] : []), live.activity,
        live.liveChars === undefined ? undefined : `↓${formatCount(live.liveChars)}`,
        live.toolCount === undefined ? undefined : t('{count} tools', { count: live.toolCount }),
        live.tokens === undefined ? undefined : t('{count} tokens', { count: formatCount(live.tokens) }),
    ];
}
export function teamNode(team, current, live, t) {
    if (team === undefined)
        return ui.loader({ message: t('Loading Team…') });
    const ownerLive = (task) => {
        const owner = team.members.find(member => member.name === task.ownerName);
        return owner === undefined ? undefined : { owner, live: live.get(owner.id) };
    };
    const people = ui.list({ id: 'members', role: 'browse', filterable: true, selectedIds: [], items: team.members.map(member => {
            const stats = live.get(member.id);
            const currentTask = team.tasks.find(task => task.status === 'in_progress' && task.ownerName === member.name);
            return {
                id: member.id, label: member.name,
                badge: member.id === current ? t('Current chat') : t(member.role === 'lead' ? 'Lead' : 'Teammate'),
                disabled: member.id === current || member.phase !== 'active',
                detail: [memberPhase(member, stats, t), ...liveMetrics(stats, t), currentTask === undefined ? undefined : `${currentTask.id} · ${currentTask.subject}`, member.error]
                    .filter((part) => part !== undefined && part !== '').join(' · '),
                searchText: `${member.name} ${member.role}`,
            };
        }) });
    const tasks = ui.list({ id: 'tasks', role: 'browse', filterable: true, selectedIds: [], items: team.tasks.map(task => {
            const owner = ownerLive(task);
            const ownerText = [
                task.ownerName ?? t('Unowned'),
                ...(owner === undefined ? [] : [memberPhase(owner.owner, owner.live, t), ...liveMetrics(owner.live, t, false)]),
            ].filter((part) => part !== undefined && part !== '').join(' · ');
            return {
                id: task.id, label: `${task.id} · ${task.subject}`, badge: taskState(task, t),
                detail: [ownerText, task.description.replace(/\s+/gu, ' '), task.blockedBy.length ? `${t('Blocked by')}: ${task.blockedBy.join(', ')}` : '', task.writeScopeWarnings.length ? t('Write scopes overlap') : ''].filter(Boolean).join(' · '),
                searchText: `${task.id} ${task.subject} ${task.description} ${task.ownerName ?? ''}`,
            };
        }), empty: ui.empty({ title: t('No shared tasks'), description: t('Create and update tasks through the conversation.') }) });
    const warnings = team.tasks.filter(task => task.writeScopeWarnings.length > 0);
    return ui.surface({ title: t('Agent Team'), chrome: 'overlay', child: ui.stack.column([
            ...(team.failure === undefined ? [] : [ui.text(team.failure, { tone: 'danger' })]),
            ui.text(t('{members} members · {tasks} unfinished tasks', { members: team.members.length, tasks: team.tasks.filter(task => task.status !== 'completed').length })),
            ...(warnings.length ? [ui.text(`${t('Write scopes overlap')}: ${warnings.map(task => task.id).join(', ')}`, { tone: 'warning' })] : []),
            ...(team.members.length === 1 ? [ui.empty({ title: t('No teammates yet'), description: t('Ask the Lead explicitly to use Agent Team and delegate work.') })] : []),
            ui.divider({ label: `${t('Members')} · ${team.members.length}` }),
            ui.child(people, { basis: 0, grow: 1, minSize: 3 }),
            ui.divider({ label: `${t('Shared tasks')} · ${team.tasks.length}` }),
            ui.child(tasks, { basis: 0, grow: 1, minSize: 3 }),
            ui.actions({ id: 'team-actions', items: [{ id: 'close', label: t('Back to conversation'), dismiss: true }] }),
        ], { gap: 1 }) });
}
