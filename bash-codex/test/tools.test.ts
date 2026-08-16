import { describe, expect, it } from 'vitest'
import { registerExecCommandTool } from '../src/tools/exec-command.js'
import { registerWriteStdinTool } from '../src/tools/write-stdin.js'

describe('bash-codex tool contract', () => {
  it('exposes only the approved exec_command parameters', () => {
    const registered: any[] = []
    registerExecCommandTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)
    expect(Object.keys(registered[0].parameters.properties).sort()).toEqual([
      'cmd', 'max_output_tokens', 'workdir', 'yield_time_ms',
    ])
    expect(registered[0].parameters.required).toEqual(['cmd'])
  })

  it('exposes only the approved write_stdin parameters', () => {
    const registered: any[] = []
    registerWriteStdinTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)
    expect(Object.keys(registered[0].parameters.properties).sort()).toEqual([
      'chars', 'max_output_tokens', 'session_id', 'yield_time_ms',
    ])
    expect(registered[0].parameters.required).toEqual(['session_id'])
  })

  it('does not accept missing required values in execute implementations', async () => {
    const registered: any[] = []
    registerExecCommandTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {
      ownerFor: () => ({}),
      exec: async () => ({ output: '', wall_time_seconds: 0 }),
    } as any)
    await expect(registered[0].execute({ cmd: '   ' }, { signal: new AbortController().signal }))
      .rejects.toThrow('cmd must be a non-empty string')
  })

  it('renders a live session id so the model can call write_stdin', () => {
    const registered: any[] = []
    registerExecCommandTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)

    expect(registered[0].output.render({}, {
      output: 'Guess #1> ',
      wall_time_seconds: 0.1,
      session_id: 42,
    })).toEqual([{ type: 'text', text: 'Guess #1> \n[session_id: 42]' }])
  })

  it('keeps the live session id visible while polling with write_stdin', () => {
    const registered: any[] = []
    registerWriteStdinTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)

    expect(registered[0].output.render({}, {
      output: 'still waiting',
      wall_time_seconds: 0.1,
      session_id: 42,
    })).toEqual([{ type: 'text', text: 'still waiting\n[session_id: 42]' }])
  })
})
