# Deprecated `/loop` GUI design draft

The current design is [ui.md](./ui.md). This file is retained only as a
historical page-based draft; do not use its separate Loops-page layout or GUI
create flow for implementation. Create loops with `/loop <seconds> <prompt>`.

## Direction

`/loop` should be a small session-scoped management page, not a terminal-style
monitor. It belongs beside DSH's existing `Chat` and `Trajectory` views and
uses the same page chrome, spacing, controls, and typography as the rest of
the application.

The page has one job: let a user see and manage recurring prompts for the
currently selected session.

- `New loop` creates a loop.
- `Delete` removes it after confirmation.
- The page remains quiet while the user is in Chat; a small summary chip can
  show that loops are active and open the page.
- No global loop dashboard, separate route, sidebar collection, or session ID
  is needed. The selected session already supplies that context.

The existing DSH view ring is the right extension point: register a
session-scoped `conversation.view` entry for the full page. If a persistent
summary is useful, register a compact `conversation.input.dock` entry as a
secondary navigation affordance.

## Page placement

The selected-session header becomes:

```text
Session title                                  Chat   Trajectory   Loops
                                               ─────────────────────────
```

The `Loops` tab uses the current conversation scrollport. Switching to it
does not create a route, change the selected workspace, or lose the Chat and
Trajectory state.

## Main page layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Loops                                             [ + New loop ]       │
│ Recurring prompts for this session                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Check build health                              Active            │ │
│ │ Every 1 second · Next run in 8s · Message inbox                  │ │
│ │ Check whether the build is still healthy.                         │ │
│ │                                                        [Delete] │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Failure summary                                  Active            │ │
│ │ Every 30 seconds · Next run in 24s · Message inbox                │ │
│ │ Summarize any new failures.                                        │ │
│ │                                                        [Delete] │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

There is no separate title field. The prompt is the only user-authored loop
content; the card may use its first line as a display-only heading. Loop IDs can
remain secondary metadata inside the delete flow, but they should not dominate
the page.

Each card contains only the information needed to make a decision:

- status badge: `Active` or `Overdue`;
- prompt preview;
- interval and next-run text;
- delivery mode: `Message inbox`;
- `Delete` action.

Do not display the owning session number in a card. This page is already
inside that session.

## Empty state

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Loops                                             [ + New loop ]       │
│                                                                      │
│                         No recurring loops yet                       │
│             Create one to send a prompt on a schedule.               │
│                                                                      │
│                              [ New loop ]                             │
└──────────────────────────────────────────────────────────────────────┘
```

The empty state has one clear action. The page tab can remain visible because
it is a session feature, but the compact composer summary should render
nothing when the session has no loops.

## Create flow

Use one controlled page form for creation. It can become a native DSH modal or
side drawer later without changing the command or projection path; v1 keeps
the form in the Loops page so it needs no new UI dependency.

```text
┌──────────────────────────────────────────────────────────────┐
│ Create loop                                              ×   │
│                                                              │
│ Prompt                                                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Check whether the build is still healthy                 │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Run every                                                    │
│ [ 1 ] seconds                                               │
│                                                              │
│                                      [Cancel] [Create loop]  │
└──────────────────────────────────────────────────────────────┘
```

Form rules:

- prompt is required and trimmed;
- interval is a positive safe integer, in seconds;
- create buttons disable while the operation is pending;
- validation errors appear beside the field and do not close the form;
- a persistence or command error appears as an inline alert with a retryable
  action where appropriate;
- successful create closes the form after the projection reflects the result and
  leaves the user on the Loops page.

## Delete flow

`Delete` first reveals an inline confirmation action instead of deleting
immediately:

```text
Delete loop?

“Check whether the build is still healthy”
Every 1 second · Message inbox wakes the agent

This stops future deliveries for this loop.

                         [Cancel] [Delete loop]
```

The destructive button must be visually distinct, keyboard reachable, and
disabled while deletion is pending. On success, remove the card from the
projection-driven list. On failure, keep the confirmation action open and
show the error.

## Compact Chat summary

The full page is the management surface. A compact dock entry may remain
visible above the composer:

```text
↻ 3 active loops · next in 8s                         [Open loops]
```

It is a real button, not a TUI status line. Clicking it selects the `Loops`
view. It should not duplicate the loop list or reserve
space when there are no loops. A warning variant can say `1 loop overdue` but
must use text as well as color.

Register the entries through existing DSH slots:

```text
view: conversation.view
id:   loops
label: Loops

dock: conversation.input.dock
id:   loop-summary
```

The exact order should follow the existing Chat/Trajectory and composer-dock
registrations rather than introducing a new layout system.

## Data and mutation path

The browser consumes a current session projection, not raw event history:

```text
loop/change events
        │
        ▼
host session projection: loop
        │
        ▼
useProjection('loop')
        │
        ▼
Loops page + composer summary
```

```ts
interface LoopProjection {
  loops: LoopRecord[]
}
```

The page derives countdown and overdue presentation from `next_at`; the
projection keeps the complete prompt and does not store UI-only state.

The UI should invoke the existing DSH session command channel for mutations,
then wait for the projection to reflect the result. It must not write events,
maintain a second loop map, or run its own scheduler. This keeps GUI actions
consistent with `/loop` commands and avoids adding a new RPC for a small
feature.

The backend contract persists only the prompt, interval, next delivery time,
and generated loop ID. No update operation is needed. No pause, resume,
run-now, global scheduling, or new persistence store is required for this GUI.

## UI states and accessibility

The page must handle these states explicitly:

- loading projection: show a small page-level loading state;
- zero loops: show the empty state;
- active loops: show cards ordered by `next_at`;
- overdue loop: show an `Overdue` badge and explanatory text;
- create/delete pending: disable the relevant controls;
- mutation failure: keep user-entered form values and show an inline alert;
- projection update after mutation: close the form or confirmation action only
  after success is confirmed by the command/projection path.

Required interaction details:

- use real buttons and labeled form controls;
- provide visible keyboard focus and a 44px minimum action target;
- keep the inline form and confirmation actions keyboard reachable;
- make form headings and errors available to assistive technology;
- do not rely on color alone for Active, Overdue, or destructive states;
- do not steal focus when countdown text or projection data changes;
- use a polite live region only for meaningful mutation results, not every
  one-second countdown repaint.

## Smallest implementation boundary

Implement the browser surface with existing DSH primitives and no new UI
dependency:

```text
src/ui/index.ts                 browser plugin entry and slot registration
src/ui/LoopsView.tsx             list, empty state, and create/delete form
src/ui/LoopsView.module.css      cards, form, and responsive layout
```

The host entry adds `sessionProjections` registration. The existing loop
runtime remains responsible for folding state and scheduling. The UI only
renders the projection and submits session-scoped commands.

## Highest-value GUI tests

Use mocked agent/model boundaries and a real DSH/Cordis/Session/ToolRuntime
host where possible; use fake timers only for countdown presentation. The
browser tests should cover:

1. the Loops tab renders for the selected session without a session ID in
   cards;
2. zero loops show the empty state and no compact summary;
3. one and multiple loops render cards ordered by `next_at`;
4. overdue loops have visible text and accessible status, not color alone;
5. `New loop` opens an empty form and validates prompt and interval;
6. a valid create submits the session command and renders the new projection;
8. `Delete` requires confirmation, then removes the card after success;
9. create/delete failures keep the user in context and show an error;
10. pending actions prevent duplicate submissions;
11. keyboard navigation, confirmation actions, and screen-reader labels work;
12. countdown repaint does not invoke any scheduler or dispatch a prompt;
13. the compact summary selects the Loops view and does not duplicate the
    management controls.
