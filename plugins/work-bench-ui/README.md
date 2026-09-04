# dsh-workbench-ui

Reusable resizable right-side Workbench surface for DeepSeek Harness Web plugins.

The package owns the panel shell and exposes a client registry. Feature plugins
register their own tab and React content without modifying the Workbench UI. The
panel occupies the host's block-level details column; opening it reduces the
conversation width, and the host drag handle controls the panel width.

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkbenchService } from 'dsh-workbench-ui/client'
import type {} from 'dsh-workbench-ui/client'
import { TerminalPanel } from './TerminalPanel.js'

export const inject = ['workbench']

export function apply(ctx: ClientContext): void {
  const workbench = ctx.get('workbench') as WorkbenchService
  ctx.effect(() => workbench.register({
    id: 'terminal',
    label: 'Terminal',
    component: TerminalPanel,
  }), 'terminal: Workbench panel')
}
```

Registered components receive `{ close }` and own the complete display area.
Use `workbench.open('terminal')`, `workbench.close()`, or
`workbench.toggle('terminal')` from another client component to control the
surface. Opening and closing also drives the host details column. Registration
is disposed with the owning plugin fiber.

Install it into the Web profile with:

```sh
dsh plugin --profile web add ./work-bench-ui
```
