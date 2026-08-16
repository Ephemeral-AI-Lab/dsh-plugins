import { describe, expect, it } from 'vitest'
import { apply } from '../../src/index.js'

describe('DHS plugin entry point', () => {
  it('registers both tools and owns a disposal effect', async () => {
    const tools: any[] = []
    const effects: Array<() => Promise<void>> = []
    const sections: any[] = []
    const ctx = {
      tools: {
        register(tool: unknown) {
          tools.push(tool)
          return () => {}
        },
      },
      systemPrompt: {
        section(section: unknown) {
          sections.push(section)
          return () => {}
        },
      },
      effect(body: () => () => Promise<void>) {
        effects.push(body())
        return () => {}
      },
    }

    apply(ctx as any, { ptyFallback: 'pipe' })
    expect(tools.map(tool => tool.name).sort()).toEqual(['exec_command', 'write_stdin'])
    expect(sections).toHaveLength(1)
    expect(effects).toHaveLength(1)
    await effects[0]!()
  })
})
