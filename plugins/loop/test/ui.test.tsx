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

describe('loop dock', () => {
  it('renders nothing for zero projected loops and reserves no space', () => {
    const view = renderLoops(undefined)
    expect(screen.queryByTestId('loop-dock')).toBeNull()
    expect(view.container.firstChild).toBeNull()
  })

  it('renders one inline row without page-only metadata or controls', () => {
    vi.useFakeTimers({ now: 0 })
    renderLoops({ loops: [record()] })

    expect(screen.getByRole('region', { name: 'Active loops' })).toBeTruthy()
    expect(screen.getByText('every 1s')).toBeTruthy()
    expect(screen.getByText('next in 1s')).toBeTruthy()
    expect(screen.getByText(record().prompt)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand loops' })).toBeNull()
    expect(screen.queryByText('loop_a')).toBeNull()
    expect(screen.queryByText('Message inbox')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('renders both rows for two loops in next-delivery order', () => {
    vi.useFakeTimers({ now: 0 })
    renderLoops({ loops: [
      record({ id: 'loop_late', prompt: 'Later', next_at: 30_000, time_in_seconds: 60 }),
      record({ id: 'loop_early', prompt: 'Soon', next_at: 2_000 }),
    ] })

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Soon')).toBeTruthy()
    expect(screen.getByText('Later')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand loops' })).toBeNull()
  })

  it('collapses three or more loops into a summary, then expands and collapses them', () => {
    vi.useFakeTimers({ now: 0 })
    renderLoops({ loops: [
      record({ id: 'loop_a', prompt: 'A', next_at: 1_000 }),
      record({ id: 'loop_b', prompt: 'B', next_at: 5_000 }),
      record({ id: 'loop_c', prompt: 'C', next_at: 9_000 }),
    ] })

    expect(screen.getByText('3 active loops · next in 1s')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand loops' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('list')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand loops' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Collapse loops' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Collapse loops' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse loops' }))
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('collapses an expanded summary with Escape and outside pointerdown', () => {
    vi.useFakeTimers({ now: 0 })
    renderLoops({ loops: [
      record({ id: 'loop_a' }),
      record({ id: 'loop_b', next_at: 2_000 }),
      record({ id: 'loop_c', next_at: 3_000 }),
    ] })

    fireEvent.click(screen.getByRole('button', { name: 'Expand loops' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('list')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand loops' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('renders interval and countdown units and marks due loops overdue', async () => {
    vi.useFakeTimers({ now: 0 })
    renderLoops({ loops: [
      record({ id: 'loop_seconds', time_in_seconds: 1, next_at: 1_000 }),
      record({ id: 'loop_minutes', time_in_seconds: 120, next_at: 120_000 }),
      record({ id: 'loop_hours', time_in_seconds: 3_600, next_at: 3_600_000 }),
      record({ id: 'loop_mixed', time_in_seconds: 90, next_at: 90_000 }),
    ] })
    fireEvent.click(screen.getByRole('button', { name: 'Expand loops' }))

    expect(screen.getByText('every 1s')).toBeTruthy()
    expect(screen.getByText('every 2m')).toBeTruthy()
    expect(screen.getByText('every 1h')).toBeTruthy()
    expect(screen.getByText('every 90s')).toBeTruthy()
    expect(screen.getByText('next in 1s')).toBeTruthy()
    expect(screen.getByText('next in 2m')).toBeTruthy()
    expect(screen.getByText('next in 1h')).toBeTruthy()
    expect(screen.getByText('next in 90s')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(screen.getAllByText('overdue').length).toBeGreaterThan(0)
  })

  it('keeps long prompts accessible while CSS truncates the visible line', () => {
    const prompt = 'A'.repeat(200)
    renderLoops({ loops: [record({ prompt })] })
    const promptNode = screen.getByText(prompt)
    expect(promptNode.getAttribute('title')).toBe(prompt)
    expect(promptNode.className).toMatch(/prompt/u)
  })

  it('deletes from the first click without a confirmation step', async () => {
    const execute = vi.fn(async () => commandSuccess)
    renderLoops({ loops: [record()] }, execute)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith('/loop delete loop_a'))
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByText('Delete this loop? Future deliveries will stop.')).toBeNull()
  })

  it('calls the session command, keeps the row pending, and waits for projection convergence', async () => {
    let projection: LoopProjection = { loops: [record()] }
    const execute = vi.fn(async () => commandSuccess)
    const view = renderLoops(projection, execute)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true))
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith('/loop delete loop_a')
    expect(screen.getByText(record().prompt)).toBeTruthy()

    projection = { loops: [] }
    view.rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    await waitFor(() => expect(screen.queryByTestId('loop-dock')).toBeNull())
    expect(execute).toHaveBeenCalledOnce()
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
  ])('keeps the row and surfaces command result shape %j', async (result, message) => {
    const execute = vi.fn(async () => result)
    renderLoops({ loops: [record()] }, execute)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
    expect(screen.getByText(record().prompt)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('converts non-Error command failures to accessible text', async () => {
    const execute = vi.fn(async () => { throw 'remote failed' })
    renderLoops({ loops: [record()] }, execute)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('remote failed'))).toBe(true))
  })

  it('updates from projection changes and repaints countdown locally without commands', async () => {
    vi.useFakeTimers({ now: 0 })
    let projection: LoopProjection | undefined
    const execute = vi.fn(async () => commandSuccess)
    const view = renderLoops(projection, execute)
    expect(screen.queryByTestId('loop-dock')).toBeNull()

    projection = { loops: [record({ next_at: 8_000 })] }
    view.rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    expect(screen.getByText('next in 8s')).toBeTruthy()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByText('next in 6s')).toBeTruthy()
    expect(execute).not.toHaveBeenCalled()

    projection = { loops: [] }
    view.rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    expect(view.container.firstChild).toBeNull()
  })

  it('returns to direct rows when a projected expanded list drops below three loops', () => {
    vi.useFakeTimers({ now: 0 })
    let projection: LoopProjection = { loops: [
      record({ id: 'loop_a' }),
      record({ id: 'loop_b', next_at: 2_000 }),
      record({ id: 'loop_c', next_at: 3_000 }),
    ] }
    const view = renderLoops(projection)
    fireEvent.click(screen.getByRole('button', { name: 'Expand loops' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    projection = { loops: [record({ id: 'loop_a' }), record({ id: 'loop_b' })] }
    view.rerender(<LoopsView useProjection={() => projection} execute={vi.fn(async () => commandSuccess)} /> as never)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Collapse loops' })).toBeNull()
  })

  it('cleans the local countdown timer on unmount', () => {
    vi.useFakeTimers({ now: 0 })
    const clearInterval = vi.spyOn(globalThis, 'clearInterval')
    const view = renderLoops({ loops: [record()] })
    view.unmount()
    expect(clearInterval).toHaveBeenCalled()
    clearInterval.mockRestore()
  })
})
