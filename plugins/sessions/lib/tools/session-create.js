import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionCreationService } from '../creation-service.js';
const CREATE_SESSION_RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        session_id: { type: 'string', required: true },
        accepted: { type: 'boolean', required: true },
        status: { type: 'string', required: true, enum: ['queued'] },
        workspace_id: { type: 'string' },
        cwd: { type: 'string' },
    },
};
export function registerSessionCreateTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'session_create',
        description: 'Create a fresh session and queue its initial prompt. Preset and model are optional; omitted values inherit from the caller or deployment defaults. Optionally bind the session to an existing directory with cwd.',
        parameters: {
            prompt: { type: 'string', required: true, description: 'Initial prompt for the new session.' },
            preset: { type: 'string', description: 'Optional agent preset ID. It is resolved when the new session is created.' },
            model: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    provider: { type: 'string', required: true, description: 'Registered model provider.' },
                    model: { type: 'string', required: true, description: 'Provider-owned model ID.' },
                    reasoningEffort: { type: 'string', description: 'Optional adapter-owned reasoning/thinking effort identifier.' },
                },
            },
            cwd: { type: 'string', description: 'Optional existing absolute working directory.' },
        },
        output: {
            schema: CREATE_SESSION_RESULT_SCHEMA,
            render: (_args, value) => renderJson(value),
        },
        async execute(args, exec) {
            return service.createSession(args, exec.agent, exec.signal);
        },
    }));
}
function renderJson(value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
//# sourceMappingURL=session-create.js.map