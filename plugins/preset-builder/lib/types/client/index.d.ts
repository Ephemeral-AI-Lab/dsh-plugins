import type { ReactNode } from 'react';
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type Key } from './locales.js';
type Api = ConnectionHandle['api'] & {
    agentPresets: ConnectionHandle['api']['agentPresets'] & {
        mutate(payload: {
            agentPreset: string;
            expectedRevision: string;
            mutation: {
                op: 'set-disabled';
                pluginId: string;
                disabled: boolean;
            } | {
                op: 'set-config';
                pluginId: string;
                config: unknown;
            };
        }): Promise<{
            result: {
                ok: true;
                value: {
                    agentPreset: string;
                };
            } | {
                ok: false;
                error: {
                    message: string;
                };
            };
        }>;
    };
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        presetBuilder: Key;
    }
}
interface Injected {
    api: Api;
}
type Props = PropsRuntime<'settings.section'> & PropsLocale<'presetBuilder'> & Injected;
export declare function PresetDetails({ api, t }: Props): ReactNode;
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map