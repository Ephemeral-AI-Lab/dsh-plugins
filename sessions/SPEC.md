# dsh-sessions specification

Status: implemented.

This plugin provides the session API required by the v2
`dsh-loop` global automation panel.

The custom plugin/package name is `dsh-sessions`; the implementation directory
is `dsh-plugins/sessions`.

This is an adapter over DSH's built-in session services. It is not a second
implementation of `@deepseek-ai/dsh-session`, and it must not duplicate the
session store or persistence backend. `dsh-sessions` owns session inspection
and fresh-session creation. The companion
`codex-session-communication` plugin owns only message sending and waiting, so
the two packages can be composed without duplicate session-management tools.

## 1. Package boundary

The package lives at `dsh-plugins/sessions` and exposes three agent-facing tools
and one human-facing slash command:

```ts
list_status({ session_id?: string, recent_n?: number }) -> { sessions: SessionStatusView[] }
```

```ts
read_session({ session_id: string, offset?: number, limit?: number }) -> ReadSessionResult
```

```ts
create_session({
  prompt: string,
  preset?: string,
  model?: { provider: string, model: string, reasoningEffort?: string },
  cwd?: string,
}) -> {
  session_id: string,
  accepted: true,
  status: "queued",
  workspace_id?: string,
  cwd?: string,
}
```

```text
/sessions status [SESSION_ID] [--recent N]
/sessions read SESSION_ID [--offset N] [--limit N]
/sessions create PROMPT [--preset ID] [--model PROVIDER/MODEL] [--effort LEVEL] [--cwd PATH]
```

It does not resume, delete, or send follow-up messages to sessions. A
`create_session` call creates a fresh session and queues only its initial
prompt. It may bind the session to an existing absolute directory with `cwd`.

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

### `list_status`

The argument may be empty. With no `session_id`, the result contains the most
recent sessions:

```ts
list_status({})
```

`recent_n` is an optional positive safe integer and defaults to 50. Results are
ordered by `updated_at` descending. When `session_id` is supplied, the result
contains exactly one row for that ID instead of the recent-session list.

```ts
interface SessionStatusView {
  session_id: string
  /** Latest durable title, when a title event exists. */
  title?: string
  status: "running" | "idle" | "cold" | "missing"
  updated_at?: string
}
```

The output contains each recent session at most once. A live agent takes
precedence over a persisted header with the same `session_id`. For an exact
query, `missing` means no live agent and no persisted session header exist; a
missing session has no `updated_at`.

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

### `create_session`

Creates a fresh session and queues its initial prompt. `prompt` is required and
must be non-empty. `preset` is an optional preset ID. `model` is an optional
object with required `provider` and `model` strings plus an optional
adapter-owned `reasoningEffort` identifier.

Location resolution is explicit:

- `cwd` must be an existing absolute directory and is canonicalized before it
  is stored. If it belongs to a registered workspace, the result also reports
  that derived `workspace_id`.
- When called by an agent and neither location is supplied, the child inherits
  the caller's session `cwd`.
- A root call with neither location is allowed but remains ungrouped; global
  automation can pass `cwd` when workspace ownership matters.

The result reports the canonical `cwd` and resolved `workspace_id` when a
location was selected. Workspace ownership is derived from persisted `cwd`;
`workspace_id` is an output-only derived field and is not a create input or
written into the session header. After the session is created, the plugin also
calls the resolved workspace's `attachSession()` so the global workspace panel
sees the new session immediately; a failed attach rolls the new agent back.

`model` and `preset` are independent options. Omitting one does not clear the
corresponding setting inherited from the caller.

Resolution order for `model` is:

1. use the explicit `{ provider, model }` when supplied;
2. otherwise, when called from an agent, inherit that agent's effective route;
3. otherwise use the deployment's default model.

Resolution order for `preset` is:

1. resolve the explicit preset ID when supplied;
2. otherwise, when called from an agent, inherit the caller's composed preset;
3. if the caller has no composed preset, resolve the deployment's default
   preset;
4. when called without an agent, resolve the deployment's default preset.

If no default preset is configured, the new session simply has no preset. If no
default model is configured for a root create, creation fails because a model
route is required.

The four parameter combinations are therefore:

| `model` | `preset` | Child/session-agent call | Root call |
| --- | --- | --- | --- |
| omitted | omitted | inherit model and preset; fall back to deployment defaults independently | use deployment defaults independently |
| provided | omitted | use explicit model; inherit preset or use its default | use explicit model and default preset |
| omitted | provided | inherit model or use its default; use explicit preset | use default model and explicit preset |
| provided | provided | use both explicit values | use both explicit values |

When `model.reasoningEffort` is supplied, the selected model and effort are
validated together through `ctx.llm.resolveCallConfig()` before the new agent
is created. The effort is then injected through `installModelSelection()` so
the first request uses it and the request header records it as an explicit
selection. When the caller's effective route contains an explicitly recorded
effort, it is carried into the new session internally. Adapter-provided default
effort is not copied as an explicit override.

The operation returns after the agent accepts the initial user message. It does
not wait for generation to finish. Reasoning effort is inherited internally
from the selected route when DSH has recorded an explicit effort, but is not a
public create parameter.

### `/sessions create`

The human-facing command calls the same creation service as the tool and passes
the current agent as the inheritance source:

```text
/sessions create PROMPT [--preset ID] [--model PROVIDER/MODEL] [--effort LEVEL] [--cwd PATH]
```

`PROMPT` may be quoted when it contains spaces. The equivalent expanded model
form is `--provider PROVIDER --model MODEL --effort LEVEL`. For automation, the
command also accepts a JSON object with the same fields as `create_session`;
unknown fields, including `workspace_id`, are rejected.

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
- `list_status.recent_n`, when supplied, must be a positive safe integer and
  defaults to 50.
- `list_status.session_id`, when supplied, must be a non-empty string.
- `read_session.offset`, when supplied, must be a positive safe integer.
- `read_session.limit`, when supplied, must be a positive safe integer no greater than 200.
- `create_session.prompt`, `model.provider`, `model.model`, and `preset`, when
  supplied, must be non-empty strings.
- `create_session.model.reasoningEffort`, when supplied, must be a non-empty
  effort identifier supported by the selected provider/model.
- `create_session.cwd`, when supplied, must be a non-empty string that resolves
  to an existing absolute directory.
- The create command rejects unknown flags and malformed model arguments.
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
- `list_status({})` returns the 50 most recently updated sessions by default.
- `list_status({ recent_n: N })` applies the same positive-integer validation.
- `list_status({ session_id })` returns one exact status row, including
  `missing` when the ID does not exist.
- `/sessions status` lists the same data as `list_status({})`.
- `/sessions status --recent N` passes `recent_n: N`.
- `/sessions status SESSION_ID` passes `session_id` and renders its exact row.
- `/sessions read SESSION_ID` returns the same bounded message window as `read_session`.
- `read_session` does not prefix messages with generated line numbers.
- `create_session` queues an initial prompt and returns a queued result.
- A child created without explicit preset/model inherits the caller's preset and
  route; a root create uses deployment defaults.
- `create_session` resolves model and preset independently for all four
  explicit/omitted combinations.
- A child whose caller has no composed preset falls back to the deployment's
  default preset when one is configured.
- A create with `cwd` canonicalizes the directory and reports its registered
  workspace when one exists.
- A child explicitly naming the same preset as its caller joins the caller's
  standing composition rather than mounting a second generation.
- `/sessions create` uses the same model/preset/location resolution as
  `create_session` and returns the queued result as JSON.
- An explicit `model.reasoningEffort` is validated before session creation and
  is applied to the first model request.
