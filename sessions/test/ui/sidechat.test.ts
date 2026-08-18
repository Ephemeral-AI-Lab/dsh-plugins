import { describe, expect, it } from 'vitest'
import { SideChatStore } from '../../src/ui/sidechat/sidechat-store.js'

const result = (id: string) => ({
  subagent_id: id,
  message_id: `message-${id}`,
  accepted: true as const,
  status: 'running' as const,
})

describe('side-chat root store', () => {
  it('keeps tabs partitioned by main session and closes without deleting them', () => {
    const store = new SideChatStore()
    store.open('main-a', result('child-a'))
    store.open('main-b', result('child-b'))
    store.close('main-a')

    expect(store.getSnapshot()['main-a']).toMatchObject({ open: false, activeSubagentId: 'child-a' })
    expect(store.getSnapshot()['main-a']?.tabs).toHaveLength(1)
    expect(store.getSnapshot()['main-b']?.activeSubagentId).toBe('child-b')
  })

  it('marks another tab unread when a background child settles', () => {
    const store = new SideChatStore()
    store.open('main', result('child-a'))
    store.open('main', result('child-b'))
    store.settle('main', 'child-a', 'finished', 'cold')

    expect(store.getSnapshot().main?.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ subagentId: 'child-a', status: 'finished', residency: 'cold', unread: true }),
    ]))
  })
})
