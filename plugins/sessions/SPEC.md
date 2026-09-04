# DSH sessions: session-tree specification

Status: proposed vNext.

This document defines the next session model for `dsh-sessions`. It is the
implementation contract for a small public surface:

- `session_create`
- `session_status`
- `session_send`

The existing v0.1.2 implementation is still an adapter over the built-in DSH
session services. It currently creates fresh sessions and exposes plain JSONL
paths. The fork/worktree tree described here is the next implementation step;
it must not be implied to be available until the tool, persistence, and UI
tests pass.

## 1. Design principles

1. A main session is the root of one session tree.
2. A fork is a specialized child session created from a completed parent
   boundary.
3. A subagent is a child session started with a fresh prompt. Subagents may
   create subagents recursively.
4. `session_create` is the only creation API. Forking is selected by a boolean
   parameter, not by a second public tool.
5. `worktree` is an opt-in placement option. Forks do not create worktrees by
   default.
6. The durable tree and the physical log layout use stable session IDs, never
   display titles.
7. Session logs are plain, append-only JSONL. Agents get the path and use
   ordinary filesystem tools to inspect it.
8. `session_status` returns a nested folder-style tree. It does not expose a
   graph with separate `nodes` and `edges` collections.
9. The sidebar shows main sessions and forks. Subagents are shown in the
   active session's existing subagent control, not as extra sidebar rows.

## 2. Terminology and ownership

### 2.1 Session kinds

Every session has one immutable `kind`:

| Kind | Meaning | May create |
| --- | --- | --- |
| `main` | Root session opened by the user or a root-level caller | subagent or fork; fork may request a worktree |
| `fork` | Child seeded from the parent's latest completed durable boundary | subagent only |
| `subagent` | Child started from a new prompt | subagent only |

Fork is a session kind, not a separate runtime or public tool. Internally it
may use DSH's fork provider, but callers always use `session_create`.

### 2.2 Parent and root

Each non-main session records:

- `parent_session_id`: the session that created it;
- `root_session_id`: the main session at the top of the tree;
- `kind`: `fork` or `subagent`;
- `created_at`: the creation timestamp;
- `cwd`: the effective working directory for that session.

The root ID is stable even when the session is displayed through a fork or a
subagent. A title may change; IDs and parent relationships may not.

### 2.3 Title

`title` is the user-facing session name. It is metadata, not identity and not a
directory name. A title may be renamed without moving a log or changing any
relationship. If no explicit title exists, the UI may fall back to the first
prompt or the session ID.

The API uses `title`; `session_name` is not a second field.

## 3. Public tools

### 3.1 `session_create`

```ts
session_create({
  prompt: string,
  title?: string,
  fork?: boolean,
  worktree?: boolean,
  preset?: string,
  model?: {
    provider: string,
    model: string,
    reasoningEffort?: string,
  },
  cwd?: string,
}) -> {
  session_id: string,
  kind: 'subagent' | 'fork',
  accepted: true,
  status: 'queued',
  parent_session_id?: string,
  root_session_id: string,
  cwd: string,
  worktree?: string,
}
```

`prompt` is required and is the initial user message for the child. `fork`
and `worktree` default to `false`.

The creation modes are:

| Caller | `fork` | `worktree` | Result |
| --- | ---: | ---: | --- |
| main | `false` | `false` | fresh `subagent` in the selected/inherited `cwd` |
| main | `true` | `false` | `fork` in the selected/inherited `cwd` |
| main | `true` | `true` | `fork` in a newly provisioned worktree |
| fork or subagent | `false` | `false` | fresh `subagent` |

The following combinations are invalid:

- `worktree: true` with `fork: false`;
- `fork: true` when the caller is a fork or subagent;
- `worktree: true` when the caller is a fork or subagent;
- a non-existent or non-absolute explicit `cwd`;
- an empty `prompt`, `title`, preset, model, or provider identifier.

When a caller is absent, the operation creates a main-level child only when
the host explicitly permits root creation. A root-level `fork: true` request
must be treated as a main-session operation, not as a child of an arbitrary
session.

### 3.2 Fork boundary

For `fork: true`, the child is seeded from the parent's latest full completed
step before `session_create` is invoked.

The boundary is the last durable point at which the parent has finished its
current model/tool step. The fork does not include:

- the `session_create` tool call itself;
- the fork request's pending result;
- an in-flight tool call or partial streaming chunk;
- events written after the boundary while the parent continues running.

The child receives a copy/reference of the complete durable prefix through the
boundary and then receives the new `prompt` as its first child-specific input.
The parent and child append to different `session.jsonl` files after creation.

If the parent has no completed durable step, the operation may fork the
available session header and completed prefix; it must not copy an incomplete
event. The implementation must reject an ambiguous boundary rather than
silently producing a partially copied conversation.

### 3.3 Worktree behavior

`worktree` is deliberately opt-in. A normal subagent and a same-directory fork
must not create a Git worktree.

When `fork: true, worktree: true`:

1. the host worktree provider allocates a directory according to its configured
   policy;
2. the child session is created with that directory as its `cwd`;
3. the result returns the canonical worktree path when available;
4. the child header records the effective `cwd` and worktree metadata;
5. the session log remains in DSH's session-tree storage, not inside the
   worktree.

The implementation must not assume that worktrees live under `/repo`,
`<repository>/.worktrees`, or any other fixed directory. The actual path is
provider-owned and must be surfaced through `session_status`.

Creation is atomic from the caller's perspective. If the worktree cannot be
created or the child cannot be initialized, the operation returns an error and
cleans up any worktree allocated solely for that failed request.

### 3.4 `session_status`

```ts
session_status({
  session_id?: string,
}) -> {
  tree: SessionTreeView,
}
```

With no `session_id`, the tool returns the caller's current main-root tree. If
`session_id` is supplied, it must identify the caller's current session or one
of its descendants; the result is that session's nested subtree. An ID outside
the caller's tree is rejected rather than becoming an unrestricted session
search API.

The response is intentionally folder-shaped:

```ts
interface SessionTreeView {
  session_id: string
  root_session_id: string
  parent_session_id?: string
  kind: 'main' | 'fork' | 'subagent'
  title?: string
  status: 'running' | 'idle' | 'cold' | 'failed' | 'missing'
  created_at?: string
  updated_at?: string
  cwd?: string
  worktree?: string
  session_path?: string
  forks: SessionTreeView[]
  subagents: SessionTreeView[]
}
```

The result must not contain `nodes`, `edges`, an untyped `children` array, or a
second flattened list. The two child collections mirror the physical folders
and make the allowed relationships visible:

```text
main
├── session.jsonl
├── forks/
│   └── fork
│       ├── session.jsonl
│       └── subagents/
│           └── subagent
└── subagents/
    └── subagent
        ├── session.jsonl
        └── subagents/
            └── subagent
```

`session_path` is the absolute path to the corresponding plain JSONL file. It
is opaque: consumers must use the returned value and must not reconstruct it
from an ID.

Status mapping remains conservative:

| Runtime condition | Status |
| --- | --- |
| live agent is processing | `running` |
| live agent exists but is not processing | `idle` |
| durable header exists without a live agent | `cold` |
| durable session is known to have failed | `failed` |
| exact lookup finds neither live nor durable session | `missing` |

`session_status` is inspection-only. It must not resume a cold session, invoke
the model, create a worktree, or modify a log.

### 3.5 `session_send`

```ts
session_send({
  session_id: string,
  message: string,
}) -> {
  session_id: string,
  accepted: true,
  status: 'queued',
}
```

`session_send` sends a new message to a direct child owned by the calling
session. A caller may send to its own direct subagent or fork, but not to an
unrelated tree and not directly to a grandchild. A child can forward work by
using its own `session_send` call.

The operation does not expose a second message transport, does not wait for
generation, and does not mutate the parent's log. The target child's log
records the message and its normal DSH lifecycle events.

## 4. Physical storage

The vNext persistence provider owns a canonical tree under the DSH home:

```text
~/.dsh/session-tree/
└── <main-session-id>/
    ├── session.jsonl
    ├── forks/
    │   └── <fork-session-id>/
    │       ├── session.jsonl
    │       └── subagents/
    │           └── <subagent-session-id>/
    │               └── session.jsonl
    └── subagents/
        └── <subagent-session-id>/
            ├── session.jsonl
            └── subagents/
                └── <subagent-session-id>/
                    └── session.jsonl
```

Rules:

- directory names are stable, validated session IDs;
- titles are never directory names;
- a main session has no parent directory;
- a fork is stored below its parent's `forks/` directory;
- every other child is stored below its parent's `subagents/` directory;
- a fork or subagent may contain `subagents/`, but only a main session may
  contain `forks/`;
- logs are kept outside code worktrees so a worktree can be deleted or moved
  without deleting session history;
- the header records `kind`, `parent_session_id`, `root_session_id`, `cwd`,
  and worktree metadata;
- the directory layout and the header must agree; a mismatch is a persistence
  error, not a reason to guess.

### 4.1 Plain JSONL policy

Every `session.jsonl` is UTF-8, append-only JSONL:

```yaml
compression: none
packChunks: false
```

The provider must not write `session.jsonl.zstd` for this profile. Agents may
use `read`, `rg`, `grep`, `jq`, or ordinary shell tools on the returned path.
The event vocabulary remains the host DSH session vocabulary; this plugin does
not invent a second transcript format.

### 4.2 Persistence boundary

The custom tree provider is the source of truth for the vNext tree. It must
implement the public persistence operations needed by DSH for creating,
appending, loading, listing, locating, and reading session logs. The provider
must not depend on a UI-only index or on a title-derived path.

Existing `sessions-plain` logs are legacy v0 data. Migration is not an
implicit side effect of `session_status`. A later migration command may import
legacy sessions into the tree, preserving their IDs and marking unavailable
parent relationships as legacy roots.

## 5. UI contract

The sidebar UI is specified separately in [`u.md`](./u.md). The important
boundary is:

- render main sessions and fork sessions in the workspace tree;
- do not render subagents as sidebar rows;
- render subagents in the active session's existing header dropdown;
- keep `session_status` complete even though the sidebar intentionally filters
  its presentation.

The sidebar is therefore a navigation surface for durable, user-selectable
sessions. The header dropdown is the operational surface for active helpers.

## 6. Compatibility and non-goals

The vNext design does not:

- add `session_read`; ordinary tools read `session_path` directly;
- retain `list_agents` as a second public tree API;
- create a worktree for every fork;
- expose a separate public `fork` tool;
- use titles as IDs or paths;
- display subagents as duplicate sidebar sessions;
- allow child sessions to create forks or worktrees;
- implement a second scheduler, transcript projection, or message database.

Until vNext is implemented, the package's current fresh-session behavior and
plain `sessions-plain` backend remain the compatibility baseline documented in
the package README and session-log design guide.

## 7. Acceptance criteria

The implementation is ready only when all of the following are true:

- `session_create({ fork: false, worktree: false })` creates a subagent and
  behaves like the current fresh-child path;
- only a main caller can request `fork: true`;
- `worktree: true` requires `fork: true` and creates no worktree otherwise;
- a fork starts at the parent's latest completed durable boundary;
- no incomplete parent tool call or fork request is copied into the child
  prefix;
- child relationships are persisted and survive process restart;
- session logs use the canonical tree layout and plain `.jsonl` files;
- worktree paths are provider-owned, returned, and recorded without assuming a
  repository-relative location;
- `session_status` returns one nested folder-style tree with `forks` and
  `subagents` arrays;
- `session_status` cannot inspect a session outside the caller's tree;
- `session_send` can address a direct child and rejects unrelated sessions;
- the sidebar renders main sessions and forks only;
- the active session header renders its subagent list and count;
- recursive subagents remain operational without appearing in the sidebar;
- no `session_read` or `list_agents` tool is required by the public design;
- existing ordinary filesystem tools can search every returned
  `session_path`.
