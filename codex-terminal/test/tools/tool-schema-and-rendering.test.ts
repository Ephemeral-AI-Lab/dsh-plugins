import { describe, expect, it } from 'vitest'
import { registerExecCommandTool } from '../../src/tools/exec-command.js'
import { registerWriteStdinTool } from '../../src/tools/write-stdin.js'

describe('codex-terminal tool contract', () => {
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
      'chars', 'job_id', 'max_output_tokens', 'yield_time_ms',
    ])
    expect(registered[0].parameters.required).toEqual(['job_id'])
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

  it('renders the promoted job id so the model can call write_stdin', () => {
    const registered: any[] = []
    registerExecCommandTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)

    expect(registered[0].output.render({}, {
      output: 'Guess #1> ',
      wall_time_seconds: 0.1,
      job_id: 'codex-terminal-7',
    })).toEqual([{ type: 'text', text: 'Guess #1> \n[job_id: codex-terminal-7]' }])
  })

  it('keeps the live job id visible while polling with write_stdin', () => {
    const registered: any[] = []
    registerWriteStdinTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)

    expect(registered[0].output.render({}, {
      output: 'still waiting',
      wall_time_seconds: 0.1,
      job_id: 'codex-terminal-7',
    })).toEqual([{ type: 'text', text: 'still waiting\n[job_id: codex-terminal-7]' }])
  })

  it('renders a successful terminal poll even when it has no output', () => {
    const registered: any[] = []
    registerWriteStdinTool({ tools: { register: (tool: unknown) => registered.push(tool) } } as any, {} as any)

    expect(registered[0].output.render({ job_id: 'codex-terminal-7' }, {
      output: '',
      wall_time_seconds: 0.1,
      exit_code: 0,
    })).toEqual([{ type: 'text', text: '[job codex-terminal-7 exited with code 0]' }])
  })
})
