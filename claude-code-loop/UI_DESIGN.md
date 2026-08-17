# `/loop` GUI design draft

Status: implementation contract. The browser surface follows this design and
does not change DSH core or the DSH web application.

## Direction

`/loop` should be a small session-scoped management page, not a terminal-style
monitor. It belongs beside DSH's existing `Chat` and `Trajectory` views and
uses the same page chrome, spacing, controls, and typography as the rest of
the application.

The page has one job: let a user see and manage recurring prompts for the
currently selected session.

- `New loop` creates a loop.
- `Edit` changes its prompt, interval, or delivery setting.
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
│ │ Every 1 second · Next run in 8s · Steer when running              │ │
│ │ Check whether the build is still healthy.                         │ │
│ │                                                   [Edit] [Delete] │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Failure summary                                  Active            │ │
│ │ Every 30 seconds · Next run in 24s · Follow-up                    │ │
│ │ Summarize any new failures.                                        │ │
│ │                                                   [Edit] [Delete] │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Every loop should have a short title separate from its delivery prompt. The
title is the card heading; the full prompt is shown below it, truncated
visually but not removed from the accessible text. Loop IDs can remain
secondary metadata inside the edit/delete flow, but they should not dominate
the page.

The GUI makes `title` required because it is a management surface. The public
tool keeps `title` optional for compatibility with the existing
`/loop <seconds> <prompt>` command; when omitted, the host derives a compact
title from the first non-empty prompt line and persists it on the next update.

Each card contains only the information needed to make a decision:

- status badge: `Active` or `Overdue`;
- prompt title and preview;
- interval and next-run text;
- delivery mode: `Steer when running` or `Follow-up`;
- `Edit` and `Delete` actions.

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

## Create and edit flow

Use one controlled page form for both operations. It can become a native DSH
modal or side drawer later without changing the command or projection path;
v1 keeps the editor in the Loops page so it needs no new UI dependency.

```text
┌──────────────────────────────────────────────────────────────┐
│ Create loop                                              ×   │
│                                                              │
│ Prompt                                                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Check whether the build is still healthy                 │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Title                                                        │
│ [ Build health check                                      ]  │
│                                                              │
│ Run every                                                    │
│ [ 1 ] seconds                                               │
│                                                              │
│ Delivery                                                     │
│ [ Steer when running                              v ]        │
│                                                              │
│                                      [Cancel] [Create loop]  │
└──────────────────────────────────────────────────────────────┘
```

Edit uses the same form:

```text
Edit loop
Title                  [existing title]
Prompt                 [existing prompt]
Run every              [existing interval] seconds
Delivery               [Steer when running / Follow-up]
                                      [Cancel] [Save changes]
```

Form rules:

- title is required in the GUI and trimmed;
- prompt is required and trimmed;
- interval is a positive safe integer, in seconds;
- delivery is a two-option control mapped to `allow_steer`;
- create and save buttons disable while the operation is pending;
- validation errors appear beside the field and do not close the editor;
- a persistence or command error appears as an inline alert with a retryable
  action where appropriate;
- successful save closes the editor after the projection reflects the result and
  leaves the user on the Loops page.

Schedule semantics for the first implementation:

- changing only the prompt or delivery mode preserves the current `next_at`;
- changing the interval schedules the next run at `now + new interval`;
- the page must show the resulting next-run text after the projection update,
  rather than guessing that the command succeeded.

## Delete flow

`Delete` first reveals an inline confirmation action instead of deleting
immediately:

```text
Delete loop?

“Check whether the build is still healthy”
Every 1 second · Steer when running

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
view. It should not expose edit controls, duplicate the loop list, or reserve
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
host session projection: claude-code-loop
        │
        ▼
useProjection('claude-code-loop')
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

The backend contract must persist an optional `title` on create and expose it
through `LoopRecord`, `LoopView`, and the projection. It must also expose GUI
editing:

```ts
loop_update({
  id: string,
  title?: string,
  prompt?: string,
  time_in_seconds?: number,
  allow_steer?: boolean,
}) -> LoopView
```

The corresponding durable event should carry the complete post-update record:

```ts
{ version: 1, operation: 'update', loop: LoopRecord }
```

That event must flush before the command reports success. No pause, resume,
run-now, global scheduling, or new persistence store is required for this GUI.

## UI states and accessibility

The page must handle these states explicitly:

- loading projection: show a small page-level loading state;
- zero loops: show the empty state;
- active loops: show cards ordered by `next_at`;
- overdue loop: show an `Overdue` badge and explanatory text;
- create/edit/delete pending: disable the relevant controls;
- mutation failure: keep user-entered form values and show an inline alert;
- projection update after mutation: close the editor or confirmation action only
  after success is confirmed by the command/projection path.

Required interaction details:

- use real buttons and labeled form controls;
- provide visible keyboard focus and a 44px minimum action target;
- keep the inline editor and confirmation actions keyboard reachable;
- make form headings and errors available to assistive technology;
- do not rely on color alone for Active, Overdue, or destructive states;
- do not steal focus when countdown text or projection data changes;
- use a polite live region only for meaningful mutation results, not every
  one-second countdown repaint.

## Smallest implementation boundary

Implement the browser surface with existing DSH primitives and no new UI
dependency:

```text
src/client/index.ts             browser plugin entry and slot registration
src/client/LoopsView.tsx         list, empty state, and CRUD form
src/client/LoopsView.module.css  cards, form, and responsive layout
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
5. `New loop` opens an empty form and validates title, prompt, and interval;
6. a valid create submits the session command and renders the new projection;
7. legacy command-created loops get a deterministic derived title;
8. `Edit` opens prefilled values and submits only the changed settings;
9. changing interval displays the projection-provided next run;
10. `Delete` requires confirmation, then removes the card after success;
11. create/edit/delete failures keep the user in context and show an error;
12. pending actions prevent duplicate submissions;
13. keyboard navigation, confirmation actions, and screen-reader labels work;
14. countdown repaint does not invoke any scheduler or dispatch a prompt;
15. the compact summary selects the Loops view and does not duplicate the
    management controls.
