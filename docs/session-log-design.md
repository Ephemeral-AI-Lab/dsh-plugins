# DSH Session Log Design

Status: implemented for the local `dsh-sessions` workflow.

This document defines how DeepSeek Harness session logs are stored, discovered,
and inspected by agents in this repository. The design deliberately keeps the
session log as a boring, ordinary filesystem artifact so agents can use the
existing `read`, `grep`, `rg`, and `bash` tools instead of a second conversation
reader.

## 1. Design goals

The session-log design has four goals:

1. Keep DSH's built-in event-sourced session model authoritative.
2. Store logs in a directly readable text format.
3. Give agents a stable path to each session log through `session_status`.
4. Avoid duplicating DSH's persistence, replay, or message-reconstruction code
   in `dsh-sessions`.

The design does not provide a second session database, a custom transcript
format, or a pretty-printed conversation projection.

## 2. Ownership and architecture

DSH owns the session lifecycle and persistence services. The plugin is an
adapter over those services:

```text
Agent / session tools
        │
        ▼
    dsh-sessions
        │
        ├── ctx.agents              live session state
        ├── ctx.sessionPersistence  durable event log and artifact path
        └── ctx.sessionQuery        durable title observations
```

The session event log remains the source of truth. `dsh-sessions` does not
maintain a parallel index or copy the log into another file.

The implementation is split across:

- [`sessions/src/service.ts`](../sessions/src/service.ts): merges live and
  persisted sessions and exposes the backend-owned log path;
- [`sessions/src/tools/session-status.ts`](../sessions/src/tools/session-status.ts):
  registers the model-facing status tool;
- [`sessions/src/creation-service.ts`](../sessions/src/creation-service.ts):
  creates fresh sessions and queues their initial prompt;
- [`sessions/cordis.patch.yml`](../sessions/cordis.patch.yml): configures the
  plain JSONL persistence backend.

## 3. On-disk format

The local profile uses the JSONL persistence backend with this configuration:

```yaml
- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions-plain')
    compression: none
    packChunks: false
```

The resulting layout is:

```text
~/.dsh/sessions-plain/
└── <encoded-project>/
    └── <encoded-session-id>/
        └── session.jsonl
```

The actual absolute path is backend-owned and is returned by DSH's public
`sessionPersistence.locate()` seam. The plugin does not reconstruct the path
from the session ID itself.

### 3.1 Why compression is disabled

`compression: none` means the file is UTF-8 JSONL rather than a
`session.jsonl.zstd` Zstandard stream. `packChunks: false` independently keeps
each persisted event as its own JSONL record. The latter is not required for
readability, but makes `rg` and line-oriented inspection easier.

The settings are independent:

| Setting | Value | Effect |
| --- | --- | --- |
| `compression` | `none` | Writes plain `.jsonl` instead of `.jsonl.zstd`. |
| `packChunks` | `false` | Does not combine consecutive streaming chunk events. |

The log remains lossless. Disabling compression does not remove events,
summarize messages, or change the event model.

### 3.2 Path encoding

Project and session identifiers are encoded into safe single path segments by
the host JSONL backend. Agents should use the returned `session_path` value as
opaque data and should not derive a path by concatenating an untrusted session
ID.

## 4. Record model

Each file is an append-only sequence of JSON objects. The first record is the
session header. Later records are durable session events.

A header has the following shape conceptually:

```json
{
  "type": "session",
  "version": 0,
  "id": "session-...",
  "createdAt": 1760000000000,
  "cwd": "/path/to/project",
  "delegationDepth": 0,
  "agentPreset": "ephemeral-ai-harness"
}
```

Event records carry the event sequence, timestamp, event type, surface
operation, and event-specific data. A simplified example is:

```json
{
  "seq": 0,
  "time": 1760000000001,
  "type": "user/message",
  "surfaceOp": "append",
  "data": {
    "id": "message-1",
    "role": "user",
    "content": [{"type": "text", "text": "Inspect the project."}],
    "source": {"kind": "user"}
  }
}
```

The exact event vocabulary belongs to `@deepseek-ai/dsh-session`. Consumers
should treat unknown event types as forward-compatible data rather than
assuming that every record is a user or assistant message.

## 5. Session discovery

`session_status` is inspection-only. It does not resume a cold session, invoke
the model, or mutate persistence.

```ts
session_status({ recent_n?: number })
session_status({ session_id: string })
```

Each result row has this shape:

```ts
interface SessionStatusView {
  session_id: string
  title?: string
  status: 'running' | 'idle' | 'cold' | 'missing'
  updated_at?: string
  session_path?: string
}
```

The plugin merges:

1. `ctx.sessionPersistence.list()` for materialized persisted sessions;
2. `ctx.agents.list()` for live sessions;
3. `ctx.sessionQuery.readTitleSnapshots()` for durable titles;
4. `ctx.sessionPersistence.locate()` for backend-owned artifact paths.

Duplicate IDs are merged with live state taking precedence. Status is mapped as
follows:

| Condition | Status |
| --- | --- |
| Live agent currently processing | `running` |
| Live agent exists but is not processing | `idle` |
| Persisted session has no live agent | `cold` |
| No live agent or persisted header for an exact lookup | `missing` |

The default list is the 50 most recently updated sessions. Exact lookups return
one row and do not apply the recent-session limit.

`session_path` is omitted when the active persistence backend does not expose a
per-session artifact. The JSONL backend does expose one, so materialized local
sessions normally return an absolute `.jsonl` path.

## 6. Agent inspection workflow

The intended workflow is:

```text
1. session_status({ recent_n: 50 })
2. Select a row's session_path.
3. Use ordinary filesystem tools on that path.
```

Examples:

```bash
SESSION_LOG='/Users/example/.dsh/sessions-plain/project/session-123/session.jsonl'

# Search for user prompts, tool calls, or a particular error.
rg -n 'authentication|tool-call|error' "$SESSION_LOG"

# Read the raw event stream.
read "$SESSION_LOG"

# Inspect selected JSONL records when jq is available.
rg '"type":"user/message"|"type":"tool/' "$SESSION_LOG" | jq .
```

The exact command depends on the available tool surface. The important rule is
that the path comes from `session_status`; agents must not guess the storage
root or decode the session ID into a filesystem path.

### 6.1 Raw log versus reconstructed conversation

The plain JSONL file is intentionally raw. It may contain:

- session metadata;
- user and assistant message events;
- tool-call and tool-result events;
- reasoning or streaming chunk events;
- lifecycle boundaries;
- request metadata and future event types.

This is different from a pretty conversation transcript. That tradeoff is
intentional: ordinary tools can search the complete durable record without the
plugin owning a second projection or hiding trace data. Agents that need a
conversation summary can inspect the relevant event records and summarize them
in the current turn.

## 7. Session creation and materialization

`session_create` creates a fresh DSH agent and queues its first user message. It
returns after the target agent accepts that message:

```ts
session_create({
  prompt: string,
  preset?: string,
  model?: {
    provider: string,
    model: string,
    reasoningEffort?: string,
  },
  cwd?: string,
})
```

The selected `cwd` is canonicalized before it is written into the session
header. When a child is created by an existing agent, the parent location and
model/preset context may be inherited according to the creation contract in
[`sessions/SPEC.md`](../sessions/SPEC.md).

Persistence may materialize a session lazily. A path returned by the backend is
a target location, not a guarantee that the file already exists at the exact
instant an agent receives it. Agents should handle a short write-in-progress
window and retry a read if necessary.

## 8. Write and recovery rules

The host persistence backend owns durability and recovery:

- events are appended in sequence order;
- writes are synchronized before they are considered durable;
- interrupted tails are handled by the persistence coordinator;
- the session header and event log are validated by the host backend;
- consumers must not edit, reorder, or delete records in place.

Agents should treat session logs as read-only inspection artifacts. To change a
session, use the supported DSH agent/session APIs rather than modifying
`session.jsonl` with a text editor.

The path is a convenience for authorized filesystem tools, not an authorization
mechanism. It may expose prompts, tool arguments, tool results, or other
sensitive workspace information; normal filesystem permissions and the DSH
tool policy still apply.

## 9. Migration and compatibility

The former local root is:

```text
~/.dsh/sessions
```

It contains compressed `session.jsonl.zstd` artifacts. The new design uses a
separate root:

```text
~/.dsh/sessions-plain
```

This separation is deliberate. The JSONL backend does not silently mix
`.jsonl` and `.jsonl.zstd` artifacts in one root, and the plugin does not
automatically rewrite the existing logs. Existing compressed sessions therefore
require an explicit, validated migration before they can be included in the
plain-log root.

A future migration utility must:

1. stop or quiesce writers;
2. decompress each source artifact;
3. validate the header and event sequence;
4. write the destination artifact durably;
5. verify the destination by reopening it through DSH persistence;
6. retain the original compressed artifact until verification succeeds.

Renaming `.jsonl.zstd` to `.jsonl` is not a valid migration.

## 10. Why `session_read` was removed

The previous plugin-owned `session_read` tool reconstructed live and cold
sessions into a bounded, pretty-printed message surface. That duplicated part
of DSH's session projection and hid raw event information.

With plain, unpacked JSONL and `session_path` discovery:

- the standard filesystem tools can search the complete record;
- no separate bounded reader needs to stay in sync with DSH message semantics;
- no browser-specific tool renderer is required;
- persistence remains owned by DSH;
- the plugin surface is reduced to discovery and creation.

The cost is that agents see raw events rather than a preformatted transcript.
That is acceptable for the current inspection and automation workflows.

## 11. Validation checklist

After installing the package into a profile:

1. Run `dsh --profile web --dump-config`.
2. Confirm `session-persistence-jsonl` uses `sessions-plain`.
3. Confirm `compression: none` and `packChunks: false`.
4. Start a new DSH Web session.
5. Call `session_status` and confirm `session_path` ends in `session.jsonl`.
6. Confirm the file is readable as UTF-8 JSONL.
7. Search the file with the ordinary `rg`/`read`/`bash` tools.
8. Confirm the model tool list contains `session_status` and `session_create`,
   but not `session_read`.
9. Confirm the DeepSeek Harness checkout has no modified files.
