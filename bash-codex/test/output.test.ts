import { describe, expect, it } from 'vitest'
import { OutputLog } from '../src/session/output-log.js'

describe('OutputLog', () => {
  it('preserves split UTF-8 sequences and does not invent token counts', () => {
    const log = new OutputLog(1024)
    const bytes = new TextEncoder().encode('你好')
    log.append('stdout', bytes.subarray(0, 2))
    log.append('stdout', bytes.subarray(2))

    const result = log.read(0, { maxOutputTokens: 10 })
    expect(result.text).toBe('你好')
    expect(result.originalTokenCount).toBeUndefined()
    expect(result.truncated).toBe(false)
  })

  it('reports hard-buffer truncation and keeps a bounded head/tail', () => {
    const log = new OutputLog(16)
    log.append('stdout', new TextEncoder().encode('0123456789ABCDEFGHIJ'))

    const result = log.read(0, { maxOutputTokens: 100 })
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('01234567')
    const continuation = log.read(result.nextCursor, { maxOutputTokens: 100 })
    expect(continuation.text).toContain('<output truncated>')
    expect(result.text.length).toBeLessThan(80)
  })

  it('wakes a bounded poll when output arrives', async () => {
    const log = new OutputLog(100)
    const controller = new AbortController()
    const waiting = log.waitForChange(0, controller.signal)
    log.append('pty', new TextEncoder().encode('ready'))
    await expect(waiting).resolves.toBeUndefined()
  })

  it('strips split ANSI and terminal-title controls while preserving text', () => {
    const log = new OutputLog(1024)
    const chunks = [
      '\u001b[1t\u001b[c\u001b[?100',
      '4h\u001b[?9001hhello\u001b]0;Windows title',
      '\u0007unicode:\u2713 \u6D4B\u8BD5',
    ]
    for (const chunk of chunks) log.append('pty', new TextEncoder().encode(chunk))
    log.finish()

    expect(log.read(0, { maxOutputTokens: 100 }).text).toBe('hellounicode:\u2713 \u6D4B\u8BD5')
  })
})
