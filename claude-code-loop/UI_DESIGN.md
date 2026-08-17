# `/loop` UI design draft

Status: design only. This file does not add browser code or change DSH.

## Direction

Give `/loop` an independent, session-scoped `Loops` page beside DSH's existing
`Chat` and `Trajectory` views. It should feel like a terse terminal process
monitor, not a dashboard:

- the `Loops` view is the primary surface and owns the full read-only list;
- a one-line status HUD above the composer keeps loop state visible while
  reading or writing chat;
- monospace metadata for cadence, IDs, and countdowns;
- no pause, stop, resume, or run-now controls in v1;
- no sidebar list and no browser-side event replay.

The live DSH page already has the required view ring: `Chat` and `Trajectory`
are session views rendered beside the conversation history. The loop page should
join that ring through the public `conversation.view` slot. Its small status HUD
belongs in `conversation.input.dock`, alongside GoalBar and QueueDock.

## Placement

Register two session-scoped entries over the same projection:

```text
view:  conversation.view
id:    loops
label: Loops
order: 10
```

The view becomes a tab beside Chat and Trajectory. Its body fills the existing
conversation scrollport, so switching tabs does not create a new route, lose
the current session, or change the selected workspace.

The persistent status HUD is a second entry:

```text
slot:  conversation.input.dock
id:    loop
order: 15
```

The shipped GoalBar uses order 10 and QueueDock uses order 20, so the resulting
stack is:

```text
┌─────────────────────────────────────────────────────────────┐
│ goal strip                                                   │  order 10
├─────────────────────────────────────────────────────────────┤
│ ↻ Loops 3 · next in 8s                              [open]   │  order 15
├─────────────────────────────────────────────────────────────┤
│ queued messages / queue dock                                │  order 20
├─────────────────────────────────────────────────────────────┤
│ message composer                                             │
├─────────────────────────────────────────────────────────────┤
│ 22 turns · 77 steps · ...                                    │  composer.dock
└─────────────────────────────────────────────────────────────┘
```

If there are no active loops, the entry returns `null`; it must not leave an
empty card or reserve vertical space.

The selected-session header becomes:

```text
Session count discovery       Chat   Trajectory   Loops
                                 ──────────────────────
```

The active `Loops` page is deliberately quiet:

```text
┌─────────────────────────────────────────────────────────────┐
│ LOOP MONITOR                                      3 ACTIVE   │
├─────────────────────────────────────────────────────────────┤
│ ↻ loop_a91   every 1s   next in 8s   steer when running      │
│   check whether the build is still healthy                    │
│                                                               │
│ ↻ loop_b27   every 30s  next in 24s  follow-up                │
│   summarize any new failures                                  │
└─────────────────────────────────────────────────────────────┘
```

Rows are read-only in v1. Creation and deletion remain `/loop` commands, so
the page is an inspection surface rather than a second command editor.

## Compact states

Use one line with a loop glyph, a pluralized label, and the earliest next run.
The text is intentionally short enough to scan while typing.

| Projection state | Display |
| --- | --- |
| one scheduled loop | `↻ Loop · 1 active · next in 24s` |
| several scheduled loops | `↻ Loops · 3 active · next in 8s` |
| one or more overdue loops | `⚠ Loop overdue · retrying` |
| no loops | render nothing |

For a scheduled loop, the countdown is presentation-only: derive it from
`next_at` and the browser clock. A one-second repaint is allowed for the label,
but it must never dispatch a prompt or become a second scheduler. The host
projection remains the source of truth.

## Status HUD interaction

The HUD is a compact navigation affordance, not the full details surface.
Clicking the line, pressing `Enter`, or pressing `Space` selects the `Loops`
view. Hover may show a short read-only tooltip, but keyboard activation must
not depend on hover.

```text
┌─ LOOP MONITOR ───────────────────────────────────────────────┐
│ 3 active · next in 8s · open Loops view for details           │
└───────────────────────────────────────────────────────────────┘
```

The `Loops` page exposes only:

- loop ID;
- prompt preview;
- interval in seconds;
- next run / overdue state;
- delivery mode (`steer when running` or `follow-up`);

The selected session is already established by the surrounding `Chat`,
`Trajectory`, and `Loops` view context, so the page must not repeat a session
ID in every row.

There are deliberately no mutation buttons. Creation and deletion remain
`/loop <seconds> <prompt>` and `/loop delete <id>` command operations.

## Data path

The browser half should consume the public session projection API used by the
existing GoalBar:

```text
host loop/change events
        │
        ▼
sessionProjections.register({ key: 'claude-code-loop', ... })
        │
        ▼
session/projection transport
        │
        ▼
useProjection('claude-code-loop')
        │
        ▼
LoopIndicator in conversation.input.dock
```

The projected wire value is:

```ts
interface LoopProjection {
  loops: Array<{
    id: string
    prompt_preview: string
    time_in_seconds: number
    next_at: number
    allow_steer: boolean
    state: 'scheduled' | 'overdue'
  }>
}
```

The projection is current session state, not a browser fold of `loop/change`
events. The browser must not scan the transcript, maintain a second loop map,
or infer ownership from raw event history. The standard session scope provides
ownership implicitly; no session identifier needs to cross into the rendered
loop rows.

## Interaction and accessibility

- Use a real `<button>` for the compact indicator so it is keyboard reachable.
- Give it an accessible name such as `3 active loops, next in 8 seconds`.
- Let the existing conversation view ring own tab semantics; the HUD only
  navigates to the `Loops` view and does not create a second tab system.
- Keep prompt previews visually truncated but available as text to assistive
  technology.
- Mark the overdue line with a warning color and text, not color alone.
- Do not steal focus when the projection changes; an overdue update may use a
  polite live region, but it must not interrupt typing.

## Implementation boundary for the next step

The next UI change should be the smallest four-file browser surface:

```text
src/ui/index.ts
src/ui/LoopPage.tsx
src/ui/LoopIndicator.tsx
src/ui/LoopIndicator.module.css
```

`src/index.ts` will additionally register the host projection definition under
`sessionProjections`. The browser entry registers `conversation.view` and
`conversation.input.dock`; selecting the HUD can use the conversation view
store's existing `view` action. The projection fold can reuse the existing loop
event shapes and stay in `src/loop.ts`; no new scheduler or persistence store is
needed.

The highest-value browser tests are:

1. zero loops hide both the tab body and HUD;
2. one loop renders the singular compact HUD line;
3. multiple loops use the earliest `next_at`;
4. overdue state renders the warning line;
5. selecting the HUD switches to the `Loops` view;
6. the page omits the redundant session ID and never reads raw events.
