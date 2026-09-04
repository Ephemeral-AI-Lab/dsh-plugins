# DSH sessions: UI specification

Status: proposed vNext.

This document defines how the session tree appears in the DSH Web client. It
keeps the existing sidebar and the existing active-session subagent control;
the new tree adds only the navigation needed for fork sessions.

The implementation contract for the tools and physical logs is in
[`SPEC.md`](./SPEC.md).

## 1. Product decision

The sidebar is for durable sessions that a user may navigate to directly:

- main sessions;
- fork sessions.

Subagents are not sidebar items. They already appear in the active session
header, as shown by the existing `2 个子代理` control. Keeping them there
prevents the same helper session from appearing twice and keeps the workspace
list navigable.

```text
sidebar                         active conversation
────────                         ───────────────────
main session                    session header
└── forks                       └── subagent dropdown
    └── fork                        ├── helper 1
                                     └── helper 2
```

The backend still returns subagents in `session_status`. The UI is allowed to
project only the parts relevant to navigation.

## 2. Sidebar layout

The current DSH sidebar remains the base layout:

```text
┌─────────────────────────────────────────┐
│  whale  DSH Local Build             ◫   │
│                                         │
│              ⊕  新会话                  │
│                                         │
│  快捷入口                                │
│      ▣  技能                         ›   │
│                                         │
│  工作区             ⌕  ☷  ▣+            │
│  📁 dsh-playground                      │
│                                         │
│  ⌄  Simple greeting session       刚刚  │
│     │                                   │
│     └─ FORKS                             │
│        └─ Authentication branch  idle   │
│           [worktree]                    │
│                                         │
│  ›  Another session                刚刚  │
└─────────────────────────────────────────┘
```

No new global panel, graph view, or second navigation column is required for
the first version.

### 2.1 Main session rows

A main session keeps the current row treatment:

- title is the primary label;
- last-updated text remains right-aligned;
- the selected row uses the existing rounded gray selection fill;
- a caret appears only when the session has at least one fork;
- clicking the title opens the session;
- clicking the caret expands or collapses its fork list.

When a main session has no forks, it behaves exactly like an existing flat
session row. There is no empty `FORKS` group.

### 2.2 Fork rows

Forks appear directly below their main parent, indented one level under a
small `FORKS` group label. A fork row shows:

- a branch/fork icon;
- the fork title;
- its status dot or short status label;
- a compact `worktree` badge only when it uses a separate worktree.

The full session ID, log path, and absolute worktree path are not shown in the
row. They are available through the session details or context menu.

```text
⌄  Simple greeting session                         刚刚
   │
   └─ FORKS
      ├─ Authentication branch       worktree   idle
      └─ UI cleanup fork                         cold
```

If a fork contains subagents, the sidebar does not add another nested
`SUBAGENTS` section. Opening that fork displays its own subagent control in
the conversation header.

### 2.3 Worktree presentation

`worktree` is a small state badge, not a second workspace tree. It indicates
that the fork's `cwd` differs because the host provisioned a worktree.

The UI must not display a guessed path such as `.worktrees/<name>`. If the
user opens details, it may show the actual provider-returned `cwd` and offer a
copy action. If the worktree is unavailable, show a neutral warning state and
keep the session row selectable.

## 3. Active-session header

The active session header remains the operational home for subagents:

```text
Simple greeting session   ◌ Ephemeral AI Harness   2 个子代理 ︿
                                                   ┌──────────────────┐
                                                   │ ● greeting 1      │
                                                   │   6.4K tok · 7秒  │
                                                   │                  │
                                                   │ ● greeting 2      │
                                                   │   3.2K tok · 2秒  │
                                                   └──────────────────┘
```

The dropdown may show:

- subagent title;
- running/idle/ready status;
- token or activity summary when already provided by the host;
- continue or message actions for continuable subagents;
- a link or action to open the subagent if the host supports it.

The session tree sidebar must not duplicate this list.

### 3.1 Recursive behavior

When a user opens a fork, the header dropdown shows the fork's own
subagents. When a subagent creates another subagent, the child remains within
that operational control hierarchy. The sidebar still shows only the durable
main/fork navigation path.

```text
sidebar navigation                  header for selected session
──────────────────                  ───────────────────────────
main                                subagents of main
└── fork                            subagents of fork when fork selected
                                    subagents may create more subagents
```

The UI does not need to render recursion as a second graph. The current
session context and the header dropdown provide the necessary scope.

## 4. Data projection

`session_status` returns a complete nested response:

```json
{
  "tree": {
    "session_id": "main-123",
    "kind": "main",
    "title": "Simple greeting session",
    "forks": [
      {
        "session_id": "fork-456",
        "kind": "fork",
        "title": "Authentication branch",
        "worktree": "/actual/provider/path",
        "forks": [],
        "subagents": [
          {
            "session_id": "agent-789",
            "kind": "subagent",
            "title": "Source checker",
            "forks": [],
            "subagents": []
          }
        ]
      }
    ],
    "subagents": []
  }
}
```

The sidebar projection is intentionally narrower:

```ts
renderSessionRow(tree)
renderForkRows(tree.forks)
// Do not render tree.subagents in the sidebar.
```

The active-session header uses the current session's `subagents` collection.
It may use the host's live subagent catalog for token and continuation state,
but it must keep the same parent-session scope.

## 5. Interaction rules

| Action | Result |
| --- | --- |
| Click main-session title | Open the main session |
| Click main-session caret | Expand/collapse its forks |
| Click fork title | Open the fork session |
| Click worktree badge | Open details or copy the actual `cwd` |
| Open active-session subagent control | Show subagents of that session |
| Continue/message a subagent | Use `session_send` within the allowed parent scope |
| Search workspace | Search main and fork rows; do not flatten subagents into results |
| Rename session | Change title only; preserve ID, path, and relationships |

Selecting a subagent from the header, if supported by the host, may open that
subagent as a focused conversation. It must not make the subagent a permanent
top-level sidebar row.

## 6. Empty, loading, and failure states

### No forks

Render the normal session row with no caret and no `FORKS` label.

### Forks loading

Keep the main session row visible and show a small inline loading indicator in
the expanded area. Do not reorder the workspace or duplicate the main row.

### Missing or cold fork

Keep the fork selectable. Use the host's existing cold/missing status treatment
and let the normal session-open flow report whether the session can be
resumed.

### Worktree unavailable

Keep the fork visible, show a warning indicator, and expose the recorded
worktree path in details. Do not silently fall back to the parent's `cwd`.

### No active subagents

The session header keeps its existing zero-subagent state. The sidebar does
not gain an empty subagent section.

## 7. Accessibility and visual rules

- Main and fork rows are keyboard-focusable controls.
- The caret is a separate button or has an equivalent accessible control name;
  it must not make expanding a row impossible without opening the session.
- Use `aria-expanded` and `aria-controls` for expanded fork groups.
- The selected session uses more than color alone: focus, selection fill, and
  the active title provide redundant state.
- Status must not rely on color alone; include a text label or accessible
  name.
- Worktree is supplemental metadata and must have an accessible label.
- Preserve the existing DSH sidebar width, typography, spacing, borders, and
  icon language. Do not introduce a new icon library or a large card layout.

## 8. Explicit non-goals

The first UI version does not include:

- subagent rows in the workspace sidebar;
- a DAG/canvas/graph view;
- a second sidebar for agents;
- raw session IDs in normal rows;
- absolute log paths in normal rows;
- automatic worktree creation when expanding a row;
- a new subagent execution panel;
- a separate browser-side session index.

The result should feel like the current DSH sidebar with one additional
expandable `FORKS` section, while the existing header remains responsible for
subagent visibility and control.
