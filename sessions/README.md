# dsh-sessions

Adds session discovery, bounded message inspection, fresh-session creation,
and message delivery to DeepSeek Harness.

## 1. Release: 0.1.1

This release provides four public agent tools:

- `session_status` for recent sessions or one exact session;
- `session_read` for bounded canonical message reads;
- `session_create` for creating a fresh session with an initial prompt;
- `session_send` for steering or following up an existing session.

It also provides the `/sessions` command family and supports explicit model
provider, model, and thinking-effort selection during session creation.

## 2. Install the plugin

Install the published package into a DSH profile:

~~~powershell
# With the DSH CLI:
dsh plugin --profile web add dsh-sessions@0.1.1

# Without the `dsh` CLI:
npm install dsh-sessions@0.1.1
~~~

The DSH profile installation is required for Harness to load the plugin. After
upgrading, restart DSH and create a new agent session so the current tool
registry is loaded.

For local development, build the package and install the checkout into the
target profile:

~~~powershell
pnpm build
dsh plugin --profile web add C:\path\to\dsh-plugins\sessions
~~~

## 3. Quick start

Create a child session, inspect it, read its conversation, and send a message:

~~~text
session_create({ "prompt": "Reply with exactly READY and nothing else." })

session_status({ "session_id": "<SESSION_ID>" })

session_read({ "session_id": "<SESSION_ID>", "offset": 1, "limit": 20 })

session_send({
  "session_id": "<SESSION_ID>",
  "message": "Continue with the next step."
})
~~~

`session_create` returns a queued result containing the new session ID. Use
that ID with the other tools.

## 4. Agent tools and command interface

### Agent tools

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `session_status` | `session_id?`, `recent_n?` | Lists recent sessions, or returns one exact status row. Defaults to the 50 most recently updated sessions. |
| `session_read` | `session_id`, `offset?`, `limit?` | Reads canonical conversation blocks without resuming or mutating the session. |
| `session_create` | `prompt`, `preset?`, `model?`, `cwd?` | Creates a fresh session and queues its initial prompt. |
| `session_send` | `session_id`, `message`, `mode?` | Sends to an existing session; `mode` defaults to `steer`. |

An explicit creation model has this shape:

~~~json
{
  "provider": "<PROVIDER>",
  "model": "<MODEL>",
  "reasoningEffort": "<LEVEL>"
}
~~~

The adapter validates the effort identifier against the selected model. The
`cwd` option must be an existing absolute directory.

### Slash commands

~~~text
/sessions status [SESSION_ID] [--recent N]
/sessions read SESSION_ID [--offset N] [--limit N]
/sessions create PROMPT [--preset ID] [--provider PROVIDER --model MODEL] [--effort LEVEL] [--cwd PATH]
/sessions send SESSION_ID MESSAGE [--mode steer|followup]
~~~

The `/sessions create` flags map to the tool's nested `model` object. A JSON
object with the same shape as `session_create` is also accepted.

## 5. Session lifecycle and delivery

- `session_create` only creates a fresh session and queues its initial prompt;
  it does not wait for model completion.
- `session_status` is inspection-only and defaults to 50 recent sessions.
- `session_read` uses a 1-based message-block offset and a maximum limit of
  200. It omits trace-only chunks, token deltas, and lifecycle records.
- `session_send` defaults to `steer`, which wakes an idle agent and targets the
  nearest step of a running agent.
- `session_send({ mode: "followup" })` queues a separate next turn.
- Cold sessions are resumed only for an explicit `session_send`; status and
  read never resume them.

The returned send `message_id` confirms accepted inbox work. It does not mean
that the target agent has finished processing the message.

## 6. E2E testing

Reusable prompt fixtures are in
[`test/e2e/prompts`](./test/e2e/prompts/). The recommended flow is create,
capture the returned `session_id`, and substitute it into the status, read, and
send prompts.

The exact registered names are required. `session_send` must not be replaced by
the built-in `send_message`, which targets subagents and has different
semantics.

## 7. Verify locally

~~~powershell
pnpm typecheck
pnpm test -- --runInBand
pnpm build
pnpm pack --dry-run
~~~

The published package includes the generated `lib` directory, the plugin patch,
the README, the implementation specification, and the reusable E2E prompt
fixtures. Unit-test sources and development dependencies are not included.

## 8. Package scope

The plugin uses public DeepSeek Harness and Cordis APIs and does not modify
DeepSeek Harness source code. `dsh-loop` owns recurring self-prompts for the
current session; `dsh-sessions` owns cross-session inspection, creation, and
message delivery.

## 9. Documentation

- [Implementation specification](./SPEC.md)
- [UI contract](./ui.md)
- [E2E prompt fixtures](./test/e2e/prompts/README.md)
