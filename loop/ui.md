# Inline loop dock

Status: current UI contract for v1.

## Decision

Loops live in the selected session's existing composer dock. There is no
separate Loops page, route, tab, sidebar collection, or TUI-style monitor.

The loop dock is additive. It must not move, replace, or change DSH's existing
goal bar, queued-message/steer/follow-up controls, composer, keyboard
shortcuts, or default message behavior.

DSH already renders `conversation.input.dock` immediately above the composer.
The loop plugin registers one session-scoped entry there, after the existing
system dock entries. The plugin owns only its loop row; DSH continues to own
the other rows.

## Visibility rule

The dock follows one simple threshold:

| Active loops | Initial display |
| --- | --- |
| 0 | Render nothing. Do not reserve space. |
| 1 | Show the loop row. |
| 2 | Show both loop rows. |
| 3 or more | Show one collapsed summary row. |

For three or more loops, clicking the summary expands the loop list in the
same dock surface. Clicking the summary again, pressing `Escape`, or clicking
outside the dock collapses it.

## Collapsed layout

```text
┌─────────────────────────────────────────────────────────────┐
│ ↻ 4 active loops · next in 1s                         Expand ▾│
└─────────────────────────────────────────────────────────────┘
```

The collapsed row shows:

- the loop glyph from the existing DSH icon set;
- the number of active loops;
- the nearest upcoming delivery as `next in ...` or `overdue`;
- an accessible expand/collapse button.

There are no per-loop delete buttons while the list is collapsed because the
collapsed row does not identify one specific loop.

## Expanded and inline layouts

One or two loops render directly as rows:

```text
┌─────────────────────────────────────────────────────────────┐
│ ↻ every 1s   next in 8s   Check whether the build is healthy │ 🗑│
│ ↻ every 30s  next in 24s  Summarize new failures             │ 🗑│
└─────────────────────────────────────────────────────────────┘
```

Three or more loops render the same rows after expansion:

```text
┌─────────────────────────────────────────────────────────────┐
│ ↻ 4 active loops                                      Collapse│
├─────────────────────────────────────────────────────────────┤
│ ↻ every 1s   next in 0s   Check whether the build is healthy │ 🗑│
│ ↻ every 5s   next in 3s   Watch the test runner              │ 🗑│
│ ↻ every 30s  next in 24s  Summarize new failures             │ 🗑│
│ ↻ every 60s  next in 51s  Check deployment status            │ 🗑│
└─────────────────────────────────────────────────────────────┘
```

Each row contains only:

- interval, such as `every 1s`;
- countdown, such as `next in 8s`, or the text `overdue`;
- the prompt, truncated to one line when necessary;
- a labeled `Delete` action.

The prompt is the only user-authored loop content. There is no title field.
The loop ID is not displayed in the normal row; it is internal data used by
the delete command and can appear in a confirmation or error message only if
needed.

## Actions intentionally excluded

The loop UI has no:

- pause or resume;
- manual trigger or run-now;
- edit or update;
- steer or follow-up mode selector;
- session ID;
- separate delivery-mode control.

The interval is the trigger. To change a loop, delete it and create a new
one. Loop delivery uses the backend message-inbox path; it does not alter the
system's native steer/follow-up controls.

## Creation

The UI does not create loops. The canonical creation path is the command:

```text
/loop <seconds> <prompt>
```

This keeps the dock management-only and avoids a second input path. Command
validation and persistence remain in the existing command/tool boundary; a
successful command appears in the dock when the session projection updates.

## Delete flow

`Delete` is the only per-loop action. It should use the existing DSH-style
confirmation behavior for destructive actions. Confirmation may be inline or
a small popover, but it must not create a page transition.

```text
Delete this loop?

Check whether the build is healthy
Every 1 second

                  [Cancel] [Delete loop]
```

The delete action is disabled while pending. On success, the row disappears
after the projection reflects the deletion. On failure, keep the row and
confirmation visible and show an accessible error.

## Layout and interaction constraints

- Use DSH's existing dock width, spacing, typography, colors, icons, and
  focus styles. Do not introduce a new visual system.
- Keep rows one line tall and visually quieter than an active execution row.
- Keep the expanded list height-limited with internal scrolling so the
  composer remains reachable.
- Use a real button for expand/collapse and a real button for every delete.
- Give icon-only buttons an accessible label and a visible focus state.
- Maintain at least a 44px pointer/keyboard target for interactive controls.
- Truncate prompts with an ellipsis; expose the full prompt through accessible
  text or a tooltip on hover/focus.
- Use text as well as color for `overdue` and error states.
- Update countdown text locally once per second without dispatching commands or
  touching the scheduler.
- Respect `prefers-reduced-motion`; no animation is required for v1.

## Data and ownership

```text
session projection
        │
        ▼
useProjection('loop')
        │
        ▼
loop dock: count, countdown, prompt, delete
```

The dock is session-scoped and renders the current projection. It must not
maintain a second loop registry, write session events directly, or run a
scheduler. Delete goes through the existing session command path; creation
starts from `/loop <seconds> <prompt>` in Chat.

The local countdown is presentation-only. It must not wake the model, send a
message, or change `next_at`.

## Acceptance checks

1. The existing goal, queue, steer, follow-up, and composer surfaces are
   unchanged.
2. Zero loops render no loop dock and reserve no vertical space.
3. One loop renders prompt, interval/countdown, and delete.
4. Two loops render both rows without a summary wrapper.
5. Three loops render one collapsed count row.
6. Expanding three or more loops shows every prompt, countdown, and delete
   action inside a bounded list.
7. Collapse works with the button, `Escape`, and outside click.
8. Creating through `/loop <seconds> <prompt>` appears through the projection.
9. Delete removes only the selected loop after confirmation and projection
   convergence.
10. Countdown repaint does not call create, delete, trigger, steer, follow-up,
    or any scheduler operation.
