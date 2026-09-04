import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './MockStatusRow.module.css';
function labelFor(state, t) {
    return t(state.mode === 'replay' ? 'replay.label' : 'run.label');
}
export function statusTextFor(state, t) {
    const label = labelFor(state, t);
    switch (state.phase) {
        case 'queued': return t('status.queued', { label });
        case 'running': return t('status.running', { label });
        case 'waiting': return t('status.waiting', { label });
        case 'failed': return t('status.failed', { label });
        case 'completed': return t('status.completed', { label });
        case 'cancelled': return t('status.cancelled', { label });
    }
}
export function MockStatusRow({ state, t }) {
    if (state === undefined || state === null)
        return null;
    const label = labelFor(state, t);
    const statusText = statusTextFor(state, t);
    const terminal = state.phase === 'completed' || state.phase === 'cancelled';
    const failed = state.phase === 'failed';
    const rowClass = [
        css.row,
        state.phase === 'waiting' ? css.waiting : '',
        terminal ? css.terminal : '',
        failed ? css.failed : '',
    ].filter(Boolean).join(' ');
    const total = Math.max(state.totalSteps, 0);
    const current = Math.min(Math.max(state.currentStep, 0), total);
    const ariaMax = Math.max(total, 1);
    const percentage = total === 0 ? 0 : Math.round((current / total) * 100);
    if (state.phase === 'failed') {
        const message = state.errorMessage ?? state.errorCode ?? 'Unknown error';
        return (_jsx("div", { className: css.dock, "data-mock-status": state.phase, role: "alert", "aria-live": "assertive", "aria-atomic": "true", title: message, children: _jsxs("div", { className: rowClass, children: [_jsx("span", { className: css.label, children: statusText }), _jsxs("span", { className: css.counter, children: [current, "/", total] }), _jsx("div", { className: css.track, role: "progressbar", "aria-label": t('progress.aria', { label }), "aria-valuemin": 0, "aria-valuemax": ariaMax, "aria-valuenow": Math.min(current, ariaMax), children: _jsx("div", { className: css.fill, style: { width: `${percentage}%` } }) }), _jsx("span", { className: css.error, children: message })] }) }));
    }
    return (_jsx("div", { className: css.dock, "data-mock-status": state.phase, role: "status", "aria-live": "polite", "aria-atomic": "true", children: _jsxs("div", { className: rowClass, children: [_jsx("span", { className: css.label, children: statusText }), _jsxs("span", { className: css.counter, children: [current, "/", total] }), _jsx("div", { className: css.track, role: "progressbar", "aria-label": t('progress.aria', { label }), "aria-valuemin": 0, "aria-valuemax": ariaMax, "aria-valuenow": Math.min(current, ariaMax), children: _jsx("div", { className: css.fill, style: { width: `${percentage}%` } }) }), state.phase === 'waiting' && _jsx("span", { className: css.context, children: t('waiting.detail') })] }) }));
}
export function MockStatusDock({ useProjection, t }) {
    return _jsx(MockStatusRow, { state: useProjection('mockStatus'), t: t });
}
//# sourceMappingURL=MockStatusRow.js.map