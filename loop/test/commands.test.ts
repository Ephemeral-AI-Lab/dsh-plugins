import { describe, expect, it } from 'vitest'
import { parseLoopCommand } from '../src/commands.js'

describe('loop command parser', () => {
  it('parses the short prompt and seconds syntax', () => {
    expect(parseLoopCommand('60  check the build  ')).toEqual({
      name: 'loop_create',
      arguments: { prompt: 'check the build', time_in_seconds: 60 },
    })
  })

  it('parses list, delete, and prompts containing separators as plain text', () => {
    expect(parseLoopCommand('list')).toEqual({ name: 'loop_list', arguments: {} })
    expect(parseLoopCommand('1 Build health :: check :: details')).toEqual({
      name: 'loop_create',
      arguments: { prompt: 'Build health :: check :: details', time_in_seconds: 1 },
    })
    expect(parseLoopCommand('delete loop_1')).toEqual({ name: 'loop_delete', arguments: { id: 'loop_1' } })
  })

  it.each([
    'create {"prompt":"check","time_in_seconds":1}',
    'create',
    '1',
    'update loop_1 {"prompt":"Deploy"}',
    'delete',
  ])('rejects malformed command %s', input => {
    expect(parseLoopCommand(input)).toBeUndefined()
  })
})
