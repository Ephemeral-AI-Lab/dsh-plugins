// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoopsView } from '../src/client/LoopsView.js'
import type { LoopProjection, LoopRecord } from '../src/types.js'

const record = (overrides: Partial<LoopRecord> = {}): LoopRecord => ({
  id: 'loop_a',
  title: 'Build health',
  prompt: 'Check whether the build is still healthy',
  time_in_seconds: 1,
  allow_steer: true,
  next_at: 1_000,
  ...overrides,
})

function renderLoops(projection: LoopProjection | undefined, execute = vi.fn(async () => ({ ok: true, value: { matched: true } }))) {
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
    expect(screen.queryByText(/session-/u)).toBeNull()
    empty.unmount()

    const late = record({ id: 'loop_late', title: 'Later', next_at: 30_000, time_in_seconds: 60 })
    const early = record({ id: 'loop_early', title: 'Due', next_at: 0, allow_steer: false })
    renderLoops({ loops: [late, early] })
    expect(screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)).toEqual(['Due', 'Later'])
    expect(screen.getByText('Due now')).toBeTruthy()
    expect(screen.getByText('Every 1m')).toBeTruthy()
    expect(screen.getByText('Follow-up')).toBeTruthy()
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

  it('closes the inline editor and validates a non-positive interval', () => {
    const { execute } = renderLoops({ loops: [] })
    fireEvent.click(screen.getByRole('button', { name: 'New loop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Title')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New loop' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Health check' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Check' } })
    fireEvent.change(screen.getByLabelText(/Repeat every/u), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    expect(screen.getByRole('alert').textContent).toContain('positive whole number')
    expect(execute).not.toHaveBeenCalled()
  })

  it('validates and creates through the session command, then waits for projection', async () => {
    let projection: LoopProjection = { loops: [] }
    const { rerender, execute } = renderLoops(projection)
    fireEvent.click(screen.getByRole('button', { name: 'New loop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    expect(screen.getByRole('alert').textContent).toContain('required')

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Health check' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Check the build' } })
    fireEvent.change(screen.getByLabelText(/Repeat every/u), { target: { value: '5' } })
    fireEvent.click(screen.getByLabelText(/Steer a running agent/u))
    await fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    expect(execute).toHaveBeenCalledWith('/loop create {"title":"Health check","prompt":"Check the build","time_in_seconds":5,"allow_steer":false}')
    expect(screen.getByDisplayValue('Health check')).toBeTruthy()

    projection = { loops: [record({
      title: 'Health check',
      prompt: 'Check the build',
      time_in_seconds: 5,
      allow_steer: false,
      next_at: 5_000,
    })] }
    rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
  })

  it('edits projected values and uses the update command', async () => {
    let projection: LoopProjection = { loops: [record()] }
    const { rerender, execute } = renderLoops(projection)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByDisplayValue('Build health')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Deploy health' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(execute).toHaveBeenCalledWith('/loop update loop_a {"title":"Deploy health","prompt":"Check whether the build is still healthy","time_in_seconds":1,"allow_steer":true}')

    projection = { loops: [record({ title: 'Deploy health' })] }
    rerender(<LoopsView useProjection={() => projection} execute={execute} /> as never)
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
  })

  it('requires delete confirmation, keeps failures visible, and closes after projected removal', async () => {
    let projection: LoopProjection = { loops: [record()] }
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { message: 'persistence failed' } })
      .mockResolvedValueOnce({ ok: true, value: { matched: true } })
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
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Build health' })).toBeNull())
  })

  it('keeps the editor open when the remote command is not recognized', async () => {
    const execute = vi.fn(async () => ({ ok: true, value: { matched: false } }))
    renderLoops({ loops: [] }, execute)
    fireEvent.click(screen.getByRole('button', { name: 'New loop' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Health check' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Check' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not recognized'))
    expect(screen.getByDisplayValue('Health check')).toBeTruthy()
  })

  it('surfaces malformed, failed, and non-Error remote command failures', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: false, error: 'backend failed' })
      .mockRejectedValueOnce('network failed')
    renderLoops({ loops: [] }, execute)
    fireEvent.click(screen.getByRole('button', { name: 'New loop' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Health check' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Check' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('did not return'))
    fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('command failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Create loop' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('network failed'))
  })
})
