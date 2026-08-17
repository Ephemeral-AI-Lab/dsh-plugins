import { describe, expect, it } from 'vitest'
import { parseLoopCommand } from '../src/commands.js'

describe('loop command parser', () => {
  it('keeps the short legacy create syntax and derives its title later', () => {
    expect(parseLoopCommand('60  check the build  ')).toEqual({
      name: 'loop_create',
      arguments: { prompt: 'check the build', time_in_seconds: 60 },
    })
  })

  it('parses GUI create, update, list, and delete forms', () => {
    expect(parseLoopCommand('list')).toEqual({ name: 'loop_list', arguments: {} })
    expect(parseLoopCommand('create {"prompt":"check","time_in_seconds":1}')).toEqual({
      name: 'loop_create',
      arguments: { prompt: 'check', time_in_seconds: 1 },
    })
    expect(parseLoopCommand('create {"title":"Build","prompt":"check","time_in_seconds":1,"allow_steer":false}')).toEqual({
      name: 'loop_create',
      arguments: { title: 'Build', prompt: 'check', time_in_seconds: 1, allow_steer: false },
    })
    expect(parseLoopCommand('update loop_1 {"title":"Deploy","allow_steer":true}')).toEqual({
      name: 'loop_update',
      arguments: { id: 'loop_1', title: 'Deploy', allow_steer: true },
    })
    expect(parseLoopCommand('delete loop_1')).toEqual({ name: 'loop_delete', arguments: { id: 'loop_1' } })
  })

  it.each([
    'create []',
    'create {',
    'create {"prompt":true,"time_in_seconds":1}',
    'create {"prompt":"check","time_in_seconds":"1"}',
    'create {"prompt":"check","time_in_seconds":1,"title":false}',
    'create {"prompt":"check","time_in_seconds":1,"allow_steer":"yes"}',
    'create {"prompt":"check","time_in_seconds":0}',
    'create {"prompt":"check","time_in_seconds":1,"extra":true}',
    'update loop_1 {}',
    'update loop_1 {',
    'update loop_1 {"title":false}',
    'update loop_1 {"prompt":false}',
    'update loop_1 {"time_in_seconds":0}',
    'update loop_1 {"time_in_seconds":1.5}',
    'update loop_1 {"time_in_seconds":"1"}',
    'update loop_1 {"allow_steer":"yes"}',
    'update loop_1 {"extra":true}',
    'delete',
    '1',
  ])('rejects malformed command %s', input => {
    expect(parseLoopCommand(input)).toBeUndefined()
  })
})
