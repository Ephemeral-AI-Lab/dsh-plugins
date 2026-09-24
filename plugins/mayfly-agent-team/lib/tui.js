import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { ui } from '@ephemeral-ai/mayfly-ui';
import { catalog, NAMESPACE } from "./locale.js";
import { teamMembership } from "./membership.js";
import { taskNode, teamNode } from "./model.js";
export const name = 'mayfly-agent-team-tui';
export const inject = ['agents', 'agentTeams', 'agentPresets', 'commands', 'sessionProjections', 'mayflyCurrentAgent', 'mayflyLocale', 'mayflyOverlays', 'mayflyStatus', 'mayflyEditorExtensions'];
const PANEL = 'agent-team.board';
const DETAIL = 'agent-team.task';
export function apply(ctx) {
    ctx.effect(() => ctx.mayflyLocale.register(NAMESPACE, catalog));
    const t = ctx.mayflyLocale.bind(NAMESPACE);
    const commands = new Map();
    let handle;
    let detail;
    let taskId;
    let lead;
    let projection;
    let status;
    let editor;
    const selectedLead = () => {
        const primary = ctx.mayflyCurrentAgent.primary();
        return primary === null ? undefined : teamMembership(ctx, primary)?.root;
    };
    const currentId = () => {
        const view = ctx.mayflyCurrentAgent.view();
        return view.displayed === 'auxiliary' ? view.auxiliary.sessionId : String(lead?.id ?? '');
    };
    const activity = () => new Map((projection?.members ?? []).flatMap(member => {
        const agent = ctx.agents.get(member.id);
        if (agent === undefined)
            return [];
        const model = ctx.sessionProjections.snapshot(agent.session, ['modelSelection']).values.modelSelection?.next?.model;
        return [[member.id, { running: agent.status === 'running', ...(model === undefined ? {} : { model }) }]];
    }));
    const node = () => teamNode(projection, currentId(), activity(), t);
    const owner = () => {
        const task = projection?.tasks.find(task => task.id === taskId);
        return projection?.members.find(member => member.name === task?.ownerName && member.phase === 'active');
    };
    const openMember = (member) => {
        if (lead === undefined || selectedLead() !== lead)
            return { kind: 'cancelled' };
        if (member === undefined || member.phase !== 'active')
            return { kind: 'failed', message: t('The member is no longer available') };
        if (member.id === lead.id)
            ctx.mayflyCurrentAgent.closeAuxiliary();
        else
            ctx.mayflyCurrentAgent.openAuxiliary({ kind: 'subagent', sessionId: member.id, parentSessionId: lead.id, label: member.name, mode: 'continuable' });
        return { kind: 'completed', dismiss: true };
    };
    const refresh = () => {
        const nextLead = selectedLead();
        if (nextLead !== lead) {
            handle?.close();
            detail?.close();
            lead = nextLead;
        }
        projection = lead === undefined ? undefined : ctx.sessionProjections.snapshot(lead.session, ['agentTeam']).values.agentTeam;
        if (lead === undefined) {
            status?.dispose();
            status = undefined;
            editor?.dispose();
            editor = undefined;
            return;
        }
        status ??= ctx.mayflyStatus.register({ id: 'agent-team.status', priority: 2, overflow: 'hide' }, null);
        status.set(projection === undefined ? null : ui.text(t('Team {members} · {tasks} tasks', { members: projection.members.length, tasks: projection.tasks.filter(task => task.status !== 'completed').length })));
        const view = ctx.mayflyCurrentAgent.view();
        const child = view.displayed === 'auxiliary' && view.auxiliary?.kind === 'subagent' && projection?.members.some(member => member.id === view.auxiliary?.sessionId)
            ? view.auxiliary : undefined;
        editor ??= ctx.mayflyEditorExtensions.register({ id: 'agent-team.conversation', priority: 5, onEvent: { action: event => {
                    if (event.kind !== 'activate' || selectedLead() !== lead)
                        return { kind: 'cancelled' };
                    if (event.actionId === 'open-team') {
                        open();
                        return { kind: 'completed' };
                    }
                    if (event.actionId === 'reply') {
                        const selected = ctx.mayflyCurrentAgent.view();
                        const target = selected.auxiliary;
                        if (selected.displayed !== 'auxiliary' || target?.kind !== 'subagent' || target.mode !== 'continuable'
                            || !projection?.members.some(member => member.id === target.sessionId && member.phase === 'active'))
                            return { kind: 'cancelled' };
                        ctx.emit('mayfly/request-subagent-reply', target);
                    }
                    return { kind: 'completed' };
                } } }, {});
        editor.set({
            ...(child === undefined ? {} : { before: ui.text(t('{name} · Lead: lead', { name: child.label }), { tone: 'accent' }) }),
            hint: t(child?.access === 'resumable' ? 'Browse history; only Send resumes this member.' : 'Close a view without stopping its member.'),
            actions: [
                { id: 'open-team', label: t('Open Team') },
                ...(child === undefined ? [] : [{ id: 'reply', label: t(child.access === 'resumable' ? 'Reply to resume' : 'Reply') }]),
            ],
        });
        if (handle?.closed === false)
            handle.set(node());
        if (detail?.closed === false) {
            const task = projection?.tasks.find(task => task.id === taskId);
            if (task === undefined)
                detail.close();
            else
                detail.set(taskNode(task, owner() !== undefined, t));
        }
    };
    function open() {
        refresh();
        if (lead === undefined)
            return;
        if (handle?.closed === false) {
            handle.focus();
            return;
        }
        const openedLead = lead;
        handle = ctx.mayflyOverlays.open({ id: PANEL, title: t('Agent Team'), presentation: 'overlay', capturing: true, width: '100%', maxHeight: '90%',
            scope: { kind: 'session', sessionId: lead.id },
            onEvent: { action: event => {
                    if (selectedLead() !== openedLead)
                        return { kind: 'cancelled' };
                    if (event.kind !== 'selection-accept')
                        return { kind: 'completed' };
                    refresh();
                    const selected = event.selectedIds[0];
                    if (event.controlId === 'members')
                        return openMember(projection?.members.find(member => member.id === selected));
                    if (event.controlId !== 'tasks')
                        return { kind: 'cancelled' };
                    const task = projection?.tasks.find(task => task.id === selected);
                    if (task === undefined)
                        return { kind: 'failed', message: t('The task is no longer available') };
                    taskId = task.id;
                    detail?.close();
                    detail = ctx.mayflyOverlays.open({ id: DETAIL, title: task.subject, presentation: 'overlay', capturing: true, width: '100%', maxHeight: '90%',
                        scope: { kind: 'session', sessionId: openedLead.id },
                        onEvent: { action: action => {
                                if (selectedLead() !== openedLead)
                                    return { kind: 'cancelled' };
                                refresh();
                                return action.kind === 'activate' && action.actionId === 'open-owner' ? openMember(owner()) : { kind: 'completed' };
                            } },
                    }, taskNode(task, owner() !== undefined, t));
                    return { kind: 'completed' };
                } },
        }, node());
    }
    const syncCommands = () => {
        for (const [agent, dispose] of commands)
            if (teamMembership(ctx, agent) === undefined) {
                dispose();
                commands.delete(agent);
            }
        for (const agent of ctx.agents.list())
            if (!commands.has(agent) && teamMembership(ctx, agent) !== undefined) {
                const scope = createScope(ctx, scopeOf(agent.ctx));
                const unregister = scope.ctx.commands.register({ name: 'team', description: t('Browse shared tasks and teammate conversations'), handler: invocation => {
                        if (invocation.agent !== ctx.mayflyCurrentAgent.current() || teamMembership(ctx, invocation.agent)?.root !== selectedLead())
                            return { kind: 'error', text: t('The selected Team changed') };
                        open();
                        return { kind: 'success' };
                    } });
                commands.set(agent, () => { unregister(); void scope.dispose(); });
            }
    };
    syncCommands();
    ctx.effect(() => ctx.mayflyCurrentAgent.subscribeView(() => { handle?.close(); detail?.close(); refresh(); }));
    ctx.effect(() => ctx.sessionProjections.onChanged((session, key) => {
        if (session === lead?.session && key === 'agentTeam' || key === 'modelSelection' && projection?.members.some(member => member.id === session.id))
            refresh();
    }));
    ctx.effect(() => ctx.mayflyLocale.subscribe(refresh));
    ctx.effect(() => ctx.mayflyOverlays.subscribe(delta => { if (delta.kind === 'remove' && delta.id === PANEL)
        detail?.close(); }));
    ctx.on('agent/created', () => { syncCommands(); refresh(); });
    ctx.on('agent/disposed', () => { syncCommands(); refresh(); });
    ctx.on('agent/status', ({ agent }) => { if (projection?.members.some(member => member.id === agent.id))
        refresh(); });
    ctx.on('agent-preset/selected', () => { syncCommands(); refresh(); });
    ctx.effect(() => () => {
        handle?.close();
        detail?.close();
        status?.dispose();
        editor?.dispose();
        for (const dispose of commands.values())
            dispose();
        commands.clear();
    });
}
