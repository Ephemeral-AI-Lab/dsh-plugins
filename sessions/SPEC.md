# dsh-sessions specification

Status: implemented.

This plugin provides the minimal read-only session API required by the v2
`dsh-loop` global automation panel.

The custom plugin/package name is `dsh-sessions`; the implementation directory
is `dsh-plugins/sessions`.

This is an adapter over DSH's built-in session services. It is not a second
implementation of `@deepseek-ai/dsh-session`, and it must not duplicate the
session store or persistence backend. If `codex-session-communication` is
already installed, its existing `list_sessions` implementation may be reused
instead of registering a second tool with the same name.

## 1. Package boundary

The package lives at `dsh-plugins/sessions` and exposes three agent-facing tools
and one human-facing slash command:

```ts
list_sessions({ limit?: number }) -> { sessions: SessionView[] }
```

```ts
check_session_status({ session_id: string }) -> SessionStatusView
```

```ts
read_session({ session_id: string, offset?: number, limit?: number }) -> ReadSessionResult
```

```text
/sessions list [--limit N]
/sessions status SESSION_ID
/sessions read SESSION_ID [--offset N] [--limit N]
```

It does not create, resume, delete, message, or change sessions.
Those actions remain outside the first version of this package.

The slash command uses the same service as the tool. It renders one compact
line per session, showing the durable title when available and the stable
`session_id` as the fallback. It is read-only and does not send a message to
any session.

### Composer completion

The client adds a local completion popup for the `read` form:

```text
/sessions read SESSION_ID
```

The popup offers the unused `--offset` and `--limit` flags. Selecting a flag
updates the draft to include the flag followed by a space, leaving the user to
enter its positive integer value. Existing flags are removed from the choices,
and a partially typed `--...` token filters the choices. This is a client-side
draft interaction; it does not invoke the agent or create a conversation
message. The local matcher treats leading/trailing whitespace and zero, one, or
multiple spaces between `/sessions` and the subcommand equivalently.

## 2. Tool contract

### `list_sessions`

The argument may be empty:

```ts
list_sessions({})
```

An optional positive `limit` bounds the number of returned sessions. Results
are ordered by `updated_at` descending when that value is available.

```ts
interface SessionView {
  session_id: string
  /** Latest durable title, when a title event exists. */
  title?: string
  status: "running" | "idle" | "cold"
  updated_at: string
}
```

The output contains each session at most once. A live agent takes precedence
over a persisted header with the same `session_id`.

### `check_session_status`

This targeted read checks one exact ID without loading it into an agent:

```ts
interface SessionStatusView {
  session_id: string
  title?: string
  status: "running" | "idle" | "cold" | "missing"
  updated_at?: string
}
```

`missing` means no live agent and no persisted session header exist. A missing
session has no `updated_at`. The command and tool share the same title and
fallback rules as `list_sessions`.

### `read_session`

This bounded read returns reconstructed conversation message blocks without
resuming the session or starting generation. The projection uses the same
canonical surface as the agent loop: raw stream chunks, token deltas,
lifecycle boundaries, request metadata, and other trace-only events are
omitted.

```ts
interface ReadSessionArgs {
  session_id: string
  /** 1-based first message block to return; defaults to 1. */
  offset?: number
  /** Maximum message blocks to return; defaults to and is capped at 200. */
  limit?: number
}

interface ReadSessionResult {
  session_id: string
  offset: number
  messages: Record<string, JsonValue>[]
  total_messages: number
}
```

The model-facing text is grouped into readable message blocks, without the
built-in `read` tool's XML envelope and without generated line numbers. A
message containing a tool call is shown as an assistant block with the tool
name and arguments; a tool result is shown as a tool block. The footer reports
the window and total, for example:

```text
(Showing messages 1-20 of 45)
```

An offset beyond a non-empty session is rejected like the built-in `read` tool.
Reading a cold session uses inspection only; it does not resume or mutate it.

### Title resolution

Titles are read from the built-in log-backed title service through the public
session-query seam (`ctx.sessionQuery.readTitle()` or the batch
`readTitleSnapshots()` form). Listing must never call
`ctx.sessionTitle.refresh()` and must never start an LLM request.

The durable title precedence is:

```text
user-renamed title
  -> LLM-generated title
  -> deterministic first-prompt fallback
  -> no stored title
```

The final step is not persisted as a title. Consumers display the stable
`session_id` when `title` is absent. A title-read failure for one session does
not remove the session row; the adapter returns that row without `title` and
keeps the ID available for selection.

## 3. Data sources

The implementation merges three public DSH sources:

1. `ctx.sessionPersistence.list()` for persisted sessions, including sessions
   that are not currently loaded;
2. `ctx.agents.list()` for live agents and their current status;
3. `ctx.sessionQuery.readTitleSnapshots()` for live-preferred and cold title
   reads.

Status mapping:

| Source state | Returned status |
| --- | --- |
| live agent currently processing | `running` |
| live agent registered but not processing | `idle` |
| persisted session with no live agent | `cold` |

The plugin must not infer that a persisted session is running merely because
it has recent history.

## 4. Validation and errors

- Empty arguments are valid.
- `limit`, when supplied, must be a positive safe integer.
- `read_session.offset`, when supplied, must be a positive safe integer.
- `read_session.limit`, when supplied, must be a positive safe integer no greater than 200.
- Unknown properties are rejected.
- Persistence failures are returned as tool errors; partial results are not
  reported as successful results.
- Missing titles are valid and are represented by an omitted `title` field.
- Listing never resumes a cold session and never invokes title generation.

## 5. Integration with dsh-loop

`dsh-loop` uses this tool/service to populate existing-session choices in the
global automation panel. A selected `session_id` is passed to
`loop_create`; the loop scheduler then resolves the session again at delivery
time because it may have become cold or unavailable after selection.

The plugin does not own the global loop registry and does not implement a
second scheduler.

## 6. Acceptance tests

- Returns live idle sessions.
- Returns live running sessions.
- Returns cold persisted sessions.
- Merges a live and persisted representation without duplicates.
- Includes the latest durable title when available.
- Preserves the precedence of user, provider, and deterministic fallback title
  events.
- Falls back to the stable session ID when no title exists.
- Orders by most recent update.
- Applies `limit` after merging and ordering.
- Rejects invalid limits and unknown properties.
- Does not mutate session persistence or agent state.
- `/sessions list` lists the same data as `list_sessions`.
- `/sessions list --limit N` applies the same positive-integer validation.
- `/sessions status SESSION_ID` lists the same data as `check_session_status`.
- `/sessions read SESSION_ID` returns the same bounded message window as `read_session`.
- `read_session` does not prefix messages with generated line numbers.
