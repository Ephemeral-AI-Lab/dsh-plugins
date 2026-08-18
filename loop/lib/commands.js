import { CallId } from '@deepseek-ai/dsh-llm';
const USAGE = 'Usage: /loop <seconds> <prompt> | /loop list | /loop delete <id>';
export function registerLoopCommand(rootCtx, commandCtx) {
    return commandCtx.commands.register({
        name: 'loop',
        description: 'Create, list, or delete a recurring prompt loop.',
        input: { hint: '<seconds> <prompt> | list | delete <id>' },
        recordInput: false,
        handler: ({ agent, commandId, rawInput, signal }) => {
            const command = parseLoopCommand(rawInput);
            if (command === undefined)
                return Promise.resolve({ kind: 'error', text: USAGE });
            return executeLoopTool(rootCtx, agent, commandId, command, signal);
        },
    });
}
export function parseLoopCommand(rawInput) {
    const input = rawInput.trim();
    if (input === 'list')
        return { name: 'loop_list', arguments: {} };
    const deleteMatch = /^delete\s+(\S+)$/u.exec(input);
    if (deleteMatch !== null) {
        const id = deleteMatch[1];
        return { name: 'loop_delete', arguments: { id } };
    }
    if (input === 'delete' || input.startsWith('delete '))
        return undefined;
    const createMatch = /^(\S+)\s+([\s\S]+)$/u.exec(input);
    if (createMatch === null)
        return undefined;
    const time = Number(createMatch[1]);
    const body = createMatch[2]?.trim();
    if (!Number.isSafeInteger(time) || time <= 0 || body === undefined || body.length === 0)
        return undefined;
    return { name: 'loop_create', arguments: { prompt: body, time_in_seconds: time } };
}
async function executeLoopTool(rootCtx, agent, commandId, command, signal) {
    const result = await rootCtx.tools.execute({
        callId: CallId(`loop-command-${commandId}`),
        name: command.name,
        arguments: command.arguments,
        agent,
        signal,
    });
    if (result.isError)
        return { kind: 'error', text: result.error.message };
    return { kind: 'success', text: result.content.find(block => block.type === 'text')?.text ?? JSON.stringify(result.value) };
}
//# sourceMappingURL=commands.js.map