// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoopsView } from '../src/ui/LoopsView.js'
import type { LoopProjection, LoopRecord } from '../src/types.js'

const record = (overrides: Partial<LoopRecord> = {}): LoopRecord => ({
  id: 'loop_a',
  prompt: 'Check whether the build is still healthy',
  time_in_seconds: 1,
  next_at: 1_000,
  ...overrides,
})

const commandSuccess = { ok: true, value: { commandId: 'cmd-1', result: { kind: 'success', text: 'ok' } } }

function renderLoops(projection: LoopProjection | undefined, execute = vi.fn(async () => commandSuccess)) {
  const view = render(<LoopsView useProjection={() => projection} execute={execute} /> as never)
  return { ...view, execute }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Loops GUI', () => {
  it('renders an empty session and multiple projected loops without a session id', async () => {
    vi.useFakeTimers({ now: 0 })
    const empty = renderLoops(undefined)
    expect(screen.getByRole('heading', { name: 'No loops yet' })).toBeTruthy()
    expect(screen.getByText('/loop 60 check the build')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New loop' })).toBeNull()
    expect(screen.queryByText(/session-/u)).toBeNull()
    empty.unmount()

    const late = record({ id: 'loop_late', prompt: 'Later', next_at: 30_000, time_in_seconds: 60 })
    const early = record({ id: 'loop_early', prompt: 'Due', next_at: 0 })
    renderLoops({ loops: [late, early] })
    expect(screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)).toEqual(['Due', 'Later'])
    expect(screen.getByText('Due now')).toBeTruthy()
    expect(screen.getByText('Every 1m')).toBeTruthy()
    expect(screen.getAllByText('Message inbox')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByText('Overdue')).toBeTruthy()
    expect(screen.getByText('Next in 28s')).toBeTruthy()
  })

  it('formats hour, minute, and mixed-second intervals and countdowns', () => {
    vi.useFakeTimers({ now: 0 })
    renderLoops({ loops: [
      record({ id: 'loop_minutes', time_in_seconds: 120, next_at: 120_000 }),
      record({ id: 'loop_hours', time_in_seconds: 3_600, next_at: 3_600_000 }),
      record({ id: 'loop_mixed', time_in_seconds: 90, next_at: 90_000 }),
    ] })
    expect(screen.getByText('Every 2m')).toBeTruthy()
    expect(screen.getByText('Every 1h')).toBeTruthy()
    expect(screen.getByText('Every 90s')).toBeTruthy()
    expect(screen.getByText('Next in 2m')).toBeTruthy()
    expect(screen.getByText('Next in 1h')).toBeTruthy()
    expect(screen.getByText('Next in 90s')).toBeTruthy()
  })

  it('shortens a long prompt for the card heading while keeping the loop intact', () => {
    vi.useFakeTimers({ now: 0 })
    const prompt = 'A'.repeat(81)
    renderLoops({ loops: [record({ prompt })] })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(`${'A'.repeat(77)}…`)
  })

  it('keeps existing loops read-only until they are deleted', () => {
    renderLoops({ loops: [record()] })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New loop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create loop' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('requires delete confirmation, keeps failures visible, and closes after projected removal', async () => {
    let projection: LoopProjection = { loops: [record()] }
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { message: 'persistence failed' } })
      .mockResolvedValueOnce(commandSuccess)
    const { rerender } = renderLoops(projection, execute)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(execute).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this loop? Future deliveries will stop.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete loop' }))
    await waitFor(() => expect(screen.getByText('persistence failed')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Delete loop' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete loop' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deleting…' })).toBeTruthy())
    projection = { loops: [record()] }
    rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    projection = { loops: [] }
    rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Check whether the build is still healthy' })).toBeNull())
  })

  it.each([
    [null, 'The loop command did not return a result.'],
    [{ ok: false, error: { message: 'remote failed' } }, 'remote failed'],
    [{ ok: false, error: null }, 'The loop command failed.'],
    [{ ok: true }, 'The loop command was not recognized.'],
    [{ ok: true, value: null }, 'The loop command failed.'],
    [{ ok: true, value: { result: { kind: 'error', text: 'remote failed' } } }, 'remote failed'],
    [{ ok: true, value: { result: { kind: 'error', text: 42 } } }, 'The loop command failed.'],
    [{ ok: true, value: { result: { kind: 'unexpected' } } }, 'The loop command failed.'],
  ])('surfaces command result shape %j', async (result, message) => {
    const execute = vi.fn(async () => result)
    renderLoops({ loops: [record()] }, execute)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete loop' }))
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
  })

  it('converts non-Error command failures to visible text', async () => {
    const execute = vi.fn(async () => { throw 'remote failed' })
    renderLoops({ loops: [record()] }, execute)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete loop' }))
    await waitFor(() => expect(screen.getByText('remote failed')).toBeTruthy())
  })

})
