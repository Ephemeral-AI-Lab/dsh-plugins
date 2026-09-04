# dsh-loop v2 UI specification

Status: design specification.

This is the UI source of truth for the cross-session loop system described in
[`SPEC_V2.md`](./SPEC_V2.md). The design extends DeepSeek Harness through its
existing Cordis slot system and visual tokens. It does not introduce a new
navigation framework, CSS reset, icon library, or browser-side scheduler.

## 1. Product surface

V2 has two UI surfaces over the same durable loop registry:

1. a compact current-session status in the composer area;
2. a global Automation Tasks control panel opened from the sidebar.

```text
profile loop registry
        |                         \
        v                          v
current session composer      global automation panel
small status only             create / list / delete all loops
```

The sidebar entry is global. It must remain available when the selected
conversation changes, when the selected session is cold, and when there are
no active loops in the selected session.

The UI exposes only the v2 operations:

- `loop_create`;
- `loop_list`;
- `loop_delete`;
- `list_sessions` for selecting an existing target session.

There are no pause, resume, edit, run-now, model-effort, or model-selection
controls in this version.

## 2. DeepSeek Harness integration

### 2.1 Sidebar position

The entry appears immediately below the existing New Session button:

```text
┌─────────────────────────┐
│  +  New Session          │
│  ◌  Automation Tasks  3  │
├─────────────────────────┤
│  Workspace               │
│  ...                     │
└─────────────────────────┘
```

The current Harness sidebar exposes `sidebar.footer.action`, but that seat is
at the bottom beside Settings. It cannot produce this placement. DSH must add
one additive root-scoped list seat after the New Session control:

```text
sidebar.new-session.after
```

The proposed seat receives the same `wide` state as the existing sidebar
controls. `dsh-loop` registers one entry in that seat; it must not replace the
whole `sidebar` or `sidebar.workspaces` slots.

The host change is intentionally small:

```tsx
<NewSessionButton />
{renderSlot('sidebar.new-session.after', { wide })}
<WorkspaceRegion />
```

The slot should be added to the sidebar slot contract and to the sidebar
snapshot/style tests. The plugin remains additive and can be disabled without
removing any shipped Harness UI.

### 2.2 Sidebar action appearance

The action follows the existing New Session geometry and the sidebar's
wide/rail behavior:

- wide state: full-width text row, icon, label, and optional count badge;
- collapsed state: 36px icon control with tooltip;
- same sidebar fill, typography, focus ring, hover fill, and spacing tokens;
- no custom gradient, shadow, bright brand color, or pill-shaped badge;
- active state uses the same selected-row treatment as the workspace browser;
- warning state uses text or an icon in addition to color.

Recommended copy, localized through the Harness locale service:

| Locale | Label |
| --- | --- |
| English | Automation Tasks |
| Simplified Chinese | 自动化任务 |

The count badge is the number of active profile loops. It is hidden when the
count is zero. A small warning indicator may be added when any loop is
overdue or has a retryable failure.

The sidebar action is a real button with:

```text
aria-label="Automation Tasks"
```

It must have a visible focus state and a minimum 44px pointer/keyboard target.

### 2.3 Panel mounting

The global panel registers into the existing root-scoped `shell.overlay` list
slot. It must not replace the `root` or `sidebar` slots and must not create a
second React root.

The sidebar action toggles the panel. The selected conversation remains
visible behind it and is not changed. Opening the panel does not create a new
session or navigate the workspace browser.

The panel is a Harness-style right-side sheet:

- aligned to the application frame, not the browser viewport;
- width `min(520px, calc(100vw - 24px))`;
- full available height with the same frame insets as sibling overlays;
- surface, border, radius, shadow, and text colors from existing DSW tokens;
- no bespoke backdrop or global page scroll lock unless the host overlay
  contract requires it;
- closes with the close button or `Escape`;
- clicking outside may close it when no form or confirmation is pending.

The panel should use the same overlay/focus behavior as the existing Settings
and Cordis panels. It owns only its inner content and does not implement shell
geometry.

## 3. Automation Tasks panel

### 3.1 Header

```text
┌──────────────────────────────────────┐
│ Automation Tasks                 ×   │
│ 3 active tasks          + New task   │
└──────────────────────────────────────┘
```

The header contains:

- localized title;
- active-task count;
- a primary but quiet `New task` button;
- a real close button with an accessible label.

Do not add tabs, a dashboard chart, or a separate filter toolbar in the first
version. The panel should be a focused list, not a second workspace.

### 3.2 Task rows

Rows are compact and list-oriented rather than large cards:

```text
┌──────────────────────────────────────┐
│ Check the deployment status       ●   │
│ Every 10 minutes · Global interface  │
│ Next run 09:20                    ⋯   │
└──────────────────────────────────────┘
```

Each row shows:

- one-line prompt preview;
- schedule summary;
- target summary;
- next run or `Overdue`;
- active, failed, or completed state when relevant;
- a delete action.

The row must not show raw implementation details by default. Session IDs may
be displayed only as a shortened secondary target label, with the complete ID
available to assistive technology or a tooltip.

Target labels:

| API target | UI label |
| --- | --- |
| omitted/current session | Current session |
| `self` | Global interface |
| `new` | New session |
| actual session ID | Selected session |

The list is populated by `loop_list({ session_id: "global" })`. It is ordered
by next execution, with overdue and failed rows first. It refreshes from the
host-owned registry when a loop changes; it does not replay session events in
the browser.

For many rows, the list scrolls internally. The header and New Task action
remain reachable while the list scrolls.

### 3.3 Empty state

```text
Automation Tasks

No automation tasks yet
Create a task to send a prompt on a schedule.

             + New task
```

The empty state is quiet and centered in the panel. It does not show a
session-specific message because the panel is global.

### 3.4 Delete flow

Delete is the only row mutation. It opens an inline confirmation or a small
Harness-style popover:

```text
Delete this automation task?

Check the deployment status
Every 10 minutes · Global interface

                 Cancel   Delete
```

The destructive action is disabled while pending. The row disappears only
after `loop_delete({ loop_id })` succeeds and the global list reflects the
deletion. On failure, retain the row and show an inline accessible error.

## 4. New task form

`New task` opens an inline panel section or a small drawer inside the existing
Automation Tasks sheet. It does not navigate away from the panel.

```text
New automation task

Prompt
┌──────────────────────────────────────┐
│ Check the deployment status           │
└──────────────────────────────────────┘

Schedule
┌────────┬────────┬────────┐
│ Every  │ After  │ Cron   │
└────────┴────────┴────────┘

Every       [ 600 ] seconds

Send to     [ Global interface       v ]

                         Cancel  Create
```

### 4.1 Form fields

Required fields:

- prompt;
- schedule kind;
- schedule value;
- target session when the target is not the current session.

Schedule controls:

- `Every`: positive integer plus a fixed `seconds` label;
- `After`: positive integer plus a fixed `seconds` label;
- `Cron`: expression input plus optional IANA time-zone input.

The form must not offer minutes or hours as alternate duration units. The
backend contract remains seconds-based.

Target options:

- Current session;
- Global interface;
- New session;
- Selected session.

Selecting `Selected session` opens a compact session picker backed by
`list_sessions({})`. The picker shows session status (`running`, `idle`, or
`cold`) and the latest durable title when available. If no title exists, it
shows the stable session ID as the label. It must not resume or mutate the
session merely because it is selected, and it must not trigger title refresh
or an LLM request.

Title display precedence is:

```text
user-renamed title
  -> LLM-generated title
  -> deterministic first-prompt fallback
  -> session_id
```

Selecting `New session` reveals the optional preset field:

```text
Preset      [ Inherit                  v ]
```

The preset field is hidden and omitted from the request for all other targets.
Model and model-effort fields never appear.

### 4.2 Form validation

- prompt is trimmed and must contain non-whitespace content;
- every/after values are positive safe integers;
- cron expression must have a valid future occurrence;
- time-zone must be a valid IANA name when supplied;
- a selected session must still exist when the form is submitted;
- preset is accepted only for `new`;
- unknown request fields are not generated by the UI.

Validation errors stay beside their fields. Network, persistence, and
scheduler errors use an inline alert and preserve the user's input.

On successful `loop_create`, close the form only after the global registry
update is reflected in the list.

## 5. Local composer status

The existing small status in `conversation.input.dock` remains useful and is
not replaced by the global panel. It shows only loops targeting the selected
local session.

```text
↻ 2 automation tasks · next in 8s       View all
```

Rules:

- zero local loops: render nothing and reserve no space;
- one or two loops: show a compact summary or rows;
- three or more loops: show a count and nearest next run;
- overdue/failed state uses text plus color;
- `View all` opens the global Automation Tasks panel;
- countdown repaint is local presentation state only;
- it never schedules, sends, creates, deletes, or replays a loop.

The local status must not display loops belonging only to another session or
the global interface.

## 6. Visual system constraints

The implementation must use the visual system already used by DSH:

- DSW alias and specific color variables;
- existing typography and font weights;
- existing border, radius, shadow, and interactive background tokens;
- existing icon primitives where an equivalent exists;
- existing tooltip and focus behavior;
- existing slot renderer and overlay lifecycle.

Do not add:

- a new icon package;
- hard-coded product colors;
- a new modal framework;
- a second global navigation rail;
- a separate CSS reset;
- large dashboard cards, charts, or decorative illustrations.

The visual hierarchy should match the screenshot and shipped Harness sidebar:
the New Session control remains the primary creation affordance; Automation
Tasks is a quiet secondary navigation row; the task panel uses restrained
rows and compact metadata.

## 7. Responsive and collapsed behavior

When the sidebar is collapsed:

- the Automation Tasks entry renders as an icon-only 36px control;
- the tooltip provides the localized label and active count when relevant;
- clicking it expands or opens the panel without changing the selected
  session.

When the viewport is narrow:

- the panel becomes an almost full-width sheet with 12px side insets;
- row metadata may wrap to two lines;
- prompt text remains truncated rather than forcing horizontal scrolling;
- the form actions remain visible and keyboard reachable.

The panel must not make the underlying conversation horizontally scroll.

Respect `prefers-reduced-motion`. No animation is required for correctness.

## 8. Accessibility and localization

- use real buttons, inputs, labels, and list semantics;
- provide an accessible name for every icon-only button;
- move focus to the panel heading or first meaningful control on open;
- return focus to the sidebar action on close;
- close with `Escape` unless a native input is consuming the key;
- keep focus inside the open dialog/sheet when the host overlay requires it;
- expose status as text, not color alone;
- use polite announcements only for meaningful create/delete results;
- do not announce every countdown repaint;
- localize all labels, errors, schedule summaries, and target labels through
  the Harness locale service;
- keep technical session IDs out of the primary reading order.

## 9. Data and mutation boundary

```text
host loop registry
        | remote snapshot / announcement
        v
AutomationTasksPanel
        | loop_create / loop_delete
        v
host tool or command boundary
```

The client does not:

- write loop storage directly;
- append session events directly;
- start timers;
- resume agents;
- resolve presets or models;
- assume that a selected session is live.

Those responsibilities remain in the host scheduler and loop tools.

The panel may maintain transient UI state for the open form, pending delete,
focus, and countdown display. It must not maintain a second authoritative loop
registry.

## 10. Required host/client changes

### DSH Harness

1. Add the `sidebar.new-session.after` root-scoped list slot.
2. Include it in the sidebar slot contract and composed props.
3. Render it immediately after the New Session control.
4. Keep the existing `sidebar.footer.action` behavior unchanged.
5. Expose the existing `shell.overlay` seat to the client plugin as normal.

### dsh-loop

1. Register the sidebar Automation Tasks action.
2. Register the global `shell.overlay` panel.
3. Keep the local `conversation.input.dock` status.
4. Consume the global loop registry snapshot/announcement surface.
5. Use the three loop tools for mutations.

### dsh-sessions

Provide `list_sessions` for the selected-session target picker. The picker is
read-only and does not become another session-management surface. It reads
titles through the built-in session-query/title services and never generates a
title while the picker is open.

## 11. High-value UI tests

### Sidebar

- action appears immediately below New Session;
- wide and collapsed sidebar layouts match existing geometry;
- active count hides at zero and updates after registry changes;
- warning indicator is accessible and not color-only;
- button focus and tooltip behavior work in both sidebar states.

### Panel

- panel opens from the sidebar without changing the selected session;
- panel closes with close button, `Escape`, and outside click when safe;
- empty, loading, active, overdue, and failed states render correctly;
- global list includes loops targeting other sessions;
- rows are ordered by next run with overdue/failed rows first;
- delete waits for registry convergence and prevents duplicate submission.

### Form

- every, after, and cron switch their fields correctly;
- duration fields accept seconds only;
- `self`, `new`, current, and selected-session targets map correctly;
- preset appears only for `new`;
- model and model-effort controls do not exist;
- session picker lists live and cold sessions;
- session picker uses durable titles and falls back to session IDs without
  invoking title generation;
- validation and mutation errors preserve form input;
- successful creation appears in the global list.

### Local status

- zero local loops reserve no space;
- local status excludes unrelated global/other-session loops;
- clicking `View all` opens the global panel;
- countdown repaint performs no scheduler or mutation operation.

## 12. Definition of done

The v2 UI is complete when:

1. the Automation Tasks action appears below New Session using the new additive
   sidebar slot;
2. the action follows the shipped sidebar wide/rail geometry and tokens;
3. the global panel opens through `shell.overlay` and preserves chat context;
4. the panel lists all profile loops and supports create/delete only;
5. the form supports every, after, cron, session targets, and conditional
   preset selection;
6. the local composer retains a small current-session status;
7. no browser-side scheduler or duplicate loop registry exists;
8. accessibility, localization, responsive, and reduced-motion checks pass;
9. the DSH sidebar slot and plugin UI tests pass without replacing any shipped
   sidebar or shell slot.
