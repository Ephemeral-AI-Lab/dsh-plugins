import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PresetDetails } from '../src/client/index.js'
import { en, type Key } from '../src/client/locales.js'

describe('PresetDetails', () => {
  it('shows effective tools and mutates a custom plugin toggle', async () => {
    const read = vi.fn().mockResolvedValue({
      result: { ok: true, value: {
        content: "- id: terminal\n  name: dsh-codex-terminal",
        revision: 'rev-1',
        plugins: [{ id: 'terminal', name: 'dsh-codex-terminal', disabled: false }],
        tools: [{ name: 'exec_command', description: 'Run a shell command.' }],
      } },
    })
    const mutate = vi.fn().mockResolvedValue({ result: { ok: true, value: { agentPreset: 'mine' } } })
    const api = {
      agentPresets: {
        list: vi.fn().mockResolvedValue({
          result: {
            ok: true,
            value: {
              presets: [{
                id: 'mine',
                name: 'My preset',
                description: 'Full coding agent.',
                trust: 'user',
                isDefault: true,
              }],
            },
          },
        }),
        read,
        mutate,
      },
    }
    const props = {
      api,
      t: (key: Key) => en[key],
    } as unknown as ComponentProps<typeof PresetDetails>

    render(<PresetDetails {...props} />)
    expect(await screen.findByText('exec_command')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))

    expect(mutate).toHaveBeenCalledWith({
      agentPreset: 'mine', expectedRevision: 'rev-1',
      mutation: { op: 'set-disabled', pluginId: 'terminal', disabled: true },
    })
  })
})
