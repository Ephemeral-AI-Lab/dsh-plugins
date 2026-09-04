import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportHeaderAction, WorkbenchHeaderAction, WorkbenchPanel } from '../src/client/Workbench.js'
import { WorkbenchRegistry } from '../src/client/registry.js'

const component = (() => null) as never

afterEach(cleanup)

describe('WorkbenchRegistry', () => {
  it('registers, opens, switches, and disposes panels', () => {
    const registry = new WorkbenchRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    const disposeTerminal = registry.register({ id: 'terminal', label: 'Terminal', component })
    registry.register({ id: 'preview', label: 'Preview', component, order: 1 })

    expect(registry.getSnapshot().items.map(item => item.id)).toEqual(['terminal', 'preview'])
    expect(registry.getSnapshot().open).toBe(false)

    registry.open('preview')
    expect(registry.getSnapshot()).toMatchObject({ open: true, activeId: 'preview' })
    registry.open('terminal')
    expect(registry.getSnapshot().activeId).toBe('terminal')

    disposeTerminal()
    expect(registry.getSnapshot()).toMatchObject({ open: false, activeId: null })
    expect(listener).toHaveBeenCalled()
  })

  it('ignores unknown panels and rejects duplicate ids', () => {
    const registry = new WorkbenchRegistry()
    registry.open('missing')
    expect(registry.getSnapshot().open).toBe(false)
    registry.register({ id: 'terminal', label: 'Terminal', component })
    expect(() => registry.register({ id: 'terminal', label: 'Again', component })).toThrow('already registered')
  })

  it('renders the registered component and switches display areas', () => {
    const registry = new WorkbenchRegistry()
    registry.register({ id: 'terminal', label: 'Terminal', component: () => <p>terminal display</p> })
    registry.register({ id: 'preview', label: 'Preview', component: () => <p>preview display</p> })

    render(<><WorkbenchHeaderAction workbench={registry} /><WorkbenchPanel workbench={registry} /></>)
    expect(screen.getByTitle('Workbench')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Workbench' }))
    expect(screen.getByText('terminal display')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByText('preview display')).toBeTruthy()
  })

  it('keeps the Workbench visible before feature panels register', () => {
    const registry = new WorkbenchRegistry()

    render(<><WorkbenchHeaderAction workbench={registry} /><WorkbenchPanel workbench={registry} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Workbench' }))

    expect(screen.getByText('No tools registered yet.')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close Workbench' }).at(-1)!)
    expect(screen.getByRole('button', { name: 'Open Workbench' })).toBeTruthy()
    expect(screen.queryByText('No tools registered yet.')).toBeNull()
  })

  it('opens and closes the host details column with the panel', () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const registry = new WorkbenchRegistry({ onOpen, onClose })
    registry.register({ id: 'terminal', label: 'Terminal', component })

    registry.open('terminal')
    registry.close()

    expect(onOpen).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('exports the current session through the header button', () => {
    const download = vi.fn(async () => {})

    render(<ExportHeaderAction {...({
      sessionId: 'session-1',
      sessionExport: { download },
    } as never)} />)

    expect(screen.getByTitle('Export session')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Export session' }))
    expect(download).toHaveBeenCalledWith('session-1')
  })
})
