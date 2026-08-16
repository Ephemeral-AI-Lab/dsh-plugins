import { describe, expect, it } from 'vitest'
import { createExecutionPolicy } from '../src/policy/execution-policy.js'

describe('execution policy boundary', () => {
  it('fails closed for the unsupported host-policy mode', () => {
    expect(() => createExecutionPolicy('host-policy')).toThrow(/unsupported/i)
  })
})
