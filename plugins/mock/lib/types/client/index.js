import { MockStatusDock } from './MockStatusRow.js';
import { en, NS, zh } from './locales.js';
/** Services required by the session-scoped composer status entry. */
export const inject = ['slots', 'locale'];
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mock: dictionaries');
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'mock-status',
        order: -100,
        locale: NS,
    }, MockStatusDock));
}
//# sourceMappingURL=index.js.map