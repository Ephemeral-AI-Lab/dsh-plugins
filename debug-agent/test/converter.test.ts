import { describe, expect, it } from 'vitest'
import { DshJsonlConversionError, convertDshJsonl } from '../src/converter.js'

function record(value: unknown): string {
  return JSON.stringify(value)
}

describe('native DSH JSONL converter', () => {
  it('preserves three sibling tool calls as one parallel step', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0, cwd: 'C:\\project' }),
      record({ type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } }),
      record({
        type: 'assistant/message',
        seq: 2,
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Calling three tools.' },
              { type: 'tool-call', id: 'c1', name: 'exec_command', arguments: '{"cmd":"one"}' },
              { type: 'tool-call', id: 'c2', name: 'exec_command', arguments: '{"cmd":"two"}' },
              { type: 'tool-call', id: 'c3', name: 'exec_command', arguments: '{"cmd":"three"}' },
            ],
          },
        },
      }),
      record({ type: 'tool/call', seq: 3, time: 2, data: { turn: 1, step: 1, callId: 'c1', name: 'exec_command', arguments: '{"cmd":"one"}' } }),
      record({ type: 'tool/result', seq: 4, time: 3, data: { turn: 1, step: 1 } }),
      record({ type: 'tool/call', seq: 5, time: 4, data: { turn: 1, step: 1, callId: 'c2', name: 'exec_command', arguments: '{"cmd":"two"}' } }),
      record({ type: 'tool/result', seq: 6, time: 5, data: { turn: 1, step: 1 } }),
      record({ type: 'tool/call', seq: 7, time: 6, data: { turn: 1, step: 1, callId: 'c3', name: 'exec_command', arguments: '{"cmd":"three"}' } }),
      record({ type: 'tool/result', seq: 8, time: 7, data: { turn: 1, step: 1 } }),
      record({
        type: 'assistant/message',
        seq: 9,
        time: 8,
        data: {
          turn: 1,
          step: 2,
          message: {
            role: 'assistant',
            content: [{ type: 'tool-call', id: 'c4', name: 'tool_a', arguments: '{}' }],
          },
        },
      }),
    ].join('\n')

    expect(convertDshJsonl(input)).toEqual({
      type: 'dsh-debug-script',
      version: 1,
      steps: [
        {
          parallel: [
            { tool: 'exec_command', args: { cmd: 'one' } },
            { tool: 'exec_command', args: { cmd: 'two' } },
            { tool: 'exec_command', args: { cmd: 'three' } },
          ],
        },
        { wait: 1 },
        { tool: 'tool_a', args: {} },
      ],
    })
  })

  it('falls back to durable tool-call events and omits old results', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0, cwd: 'C:\\project' }),
      record({ type: 'tool/call', seq: 1, time: 0, data: { turn: 1, step: 1, callId: 'c1', name: 'tool_a', arguments: '{"x":1}' } }),
      record({ type: 'tool/result', seq: 2, time: 1, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' } } } }),
    ].join('\n')

    expect(convertDshJsonl(input).steps).toEqual([{ tool: 'tool_a', args: { x: 1 } }])
  })

  it('uses a complete assistant message when transport chunks are split across packed and delta records', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'tool-call-chunks',
        seq0: 1,
        time0: 1,
        data: { turn: 1, step: 1, id: 'c1', name: 'tool_a', args: ['{', '"x":'] },
      }),
      record({
        type: 'assistant/chunk',
        seq: 2,
        time: 2,
        data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', id: 'c1', name: 'tool_a', argumentsDelta: '1}' } },
      }),
      record({
        type: 'assistant/message',
        seq: 3,
        time: 3,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'tool-call', id: 'c1', name: 'tool_a', arguments: '{"x":1}' }],
          },
        },
      }),
    ].join('\n')

    expect(convertDshJsonl(input).steps).toEqual([{ tool: 'tool_a', args: { x: 1 } }])
  })

  it('assembles packed argument chunks with a trailing assistant delta', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'tool-call-chunks',
        seq0: 1,
        time0: 1,
        data: { turn: 1, step: 1, id: 'c1', name: 'tool_a', args: ['{', '"x":'] },
      }),
      record({
        type: 'assistant/chunk',
        seq: 2,
        time: 2,
        data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', id: 'c1', name: 'tool_a', argumentsDelta: '1}' } },
      }),
    ].join('\n')

    expect(convertDshJsonl(input).steps).toEqual([{ tool: 'tool_a', args: { x: 1 } }])
  })

  it('rejects conflicting complete assistant calls instead of hiding packed chunks', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'tool-call-chunks',
        seq: 1,
        data: { turn: 1, step: 1, id: 'c1', name: 'tool_a', args: ['{"x":1}'] },
      }),
      record({
        type: 'assistant/message',
        seq: 2,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'tool-call', id: 'c1', name: 'tool_a', arguments: '{"x":2}' }],
          },
        },
      }),
    ].join('\n')

    expect(() => convertDshJsonl(input)).toThrow(/records (2 and 3|3 and 2)/)
    try {
      convertDshJsonl(input)
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONVERSION_MISMATCH' })
    }
  })

  it('rejects conflicting complete chunk representations', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'tool-call-chunks',
        seq: 1,
        data: { turn: 1, step: 1, id: 'c1', name: 'tool_a', args: ['{"x":1}'] },
      }),
      record({
        type: 'assistant/chunk',
        seq: 2,
        data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', id: 'c1', name: 'tool_a', argumentsDelta: '{"x":2}' } },
      }),
    ].join('\n')

    expect(() => convertDshJsonl(input)).toThrow(/conflicting complete chunk arguments/)
  })

  it('reassembles interleaved packed and assistant chunks from the external fixture shape', () => {
    const completeArguments = '{"cmd":"wsl bash -lc \\"cd /mnt/c/Users/yifan/code/Ephemeral-AI-Lab/dsh-plugins/debug-agent && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && echo TYPECHECK_OK\\"","workdir":"C:\\\\Users\\\\yifan\\\\code\\\\Ephemeral-AI-Lab\\\\dsh-plugins\\\\debug-agent","yield_time_ms":60000}'
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'tool-call-chunks',
        data: {
          turn: 3,
          step: 4,
          id: 'call-1',
          name: 'exec_command',
          args: ['', '{', '"cmd": "w', 'sl bash -lc', ' \\\"cd', ' /mnt/c/Users', '/yifan/c', 'ode/Eph', 'emeral-AI-Lab', '/dsh-pl'],
        },
      }),
      record({
        type: 'assistant/chunk',
        data: { turn: 3, step: 4, chunk: { type: 'tool-call-delta', id: 'call-1', name: 'exec_command', argumentsDelta: 'ugins/debug' } },
      }),
      record({
        type: 'assistant/chunk',
        data: { turn: 3, step: 4, chunk: { type: 'tool-call-delta', id: 'call-1', name: 'exec_command', argumentsDelta: '-agent && node nod' } },
      }),
      record({
        type: 'tool-call-chunks',
        data: {
          turn: 3,
          step: 4,
          id: 'call-1',
          name: 'exec_command',
          args: ['e_modules/typescript/bin', '/tsc -', 'p tsconfig.json', ' --noEmi', 't && echo T', 'YPECHECK_OK', '\\""', ', "workdir": "C:\\\\Users', '\\\\yifan', '\\\\code\\\\E', 'phemeral-AI'],
        },
      }),
      record({
        type: 'tool-call-chunks',
        data: {
          turn: 3,
          step: 4,
          id: 'call-1',
          name: 'exec_command',
          args: ['-Lab\\\\dsh-pl', 'ugins\\\\debug', '-agent"', ', "yield_time_ms": 600', '00}'],
        },
      }),
      record({
        type: 'assistant/chunk',
        data: { turn: 3, step: 4, chunk: { type: 'block-end', block: { type: 'tool-call', id: 'call-1', name: 'exec_command', arguments: completeArguments } } },
      }),
    ].join('\n')

    expect(convertDshJsonl(input).steps).toEqual([{
      tool: 'exec_command',
      args: JSON.parse(completeArguments),
    }])
  })

  it('reports all source records for an incomplete multi-record chunk sequence', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'assistant/chunk',
        seq: 1,
        data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', id: 'c1', name: 'tool_a', argumentsDelta: '{"x":' } },
      }),
      record({
        type: 'assistant/chunk',
        seq: 2,
        data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', id: 'c1', name: 'tool_a', argumentsDelta: '' } },
      }),
    ].join('\r\n')

    expect(() => convertDshJsonl(input)).toThrow(/line 2:.*records 2, 3/)
  })

  it('reconstructs multiple packed calls in parallel from CRLF multi-record input', () => {
    const input = [
      record({ type: 'session', version: 0, id: 'session-1', createdAt: 0 }),
      record({
        type: 'tool-call-chunks',
        seq: 1,
        data: { turn: 1, step: 1, id: 'c1', name: 'tool_a', args: ['{"x":'] },
      }),
      record({
        type: 'tool-call-chunks',
        seq: 2,
        data: { turn: 1, step: 1, id: 'c1', name: 'tool_a', args: ['1}'] },
      }),
      record({
        type: 'tool-call-chunks',
        seq: 3,
        data: { turn: 1, step: 1, id: 'c2', name: 'tool_b', args: ['{"y":2}'] },
      }),
    ].join('\r\n')

    expect(convertDshJsonl(input).steps).toEqual([{
      parallel: [
        { tool: 'tool_a', args: { x: 1 } },
        { tool: 'tool_b', args: { y: 2 } },
      ],
    }])
  })

  it('reports malformed JSONL and malformed arguments with line context', () => {
    expect(() => convertDshJsonl('{"type":"session"}\nnot-json')).toThrow(DshJsonlConversionError)
    expect(() => convertDshJsonl([
      record({ type: 'session', version: 0, id: 'session-1' }),
      record({
        type: 'assistant/message',
        seq: 1,
        data: {
          turn: 1,
          step: 1,
          message: { content: [{ type: 'tool-call', name: 'tool_a', arguments: '{bad' }] },
        },
      }),
    ].join('\n'))).toThrow(/line 2/)
  })
})
