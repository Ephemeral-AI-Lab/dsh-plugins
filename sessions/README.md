# dsh-sessions

Adds session discovery, plain session-log paths, and fresh-session creation to
DeepSeek Harness.

## 1. Release: 0.1.2

This release provides three public agent tools:

- `session_status` for recent sessions or one exact session;
- `session_create` for creating a fresh session with an initial prompt;
- `session_send` for steering or following up with an existing session;

It supports explicit model provider, model, and thinking-effort selection during
session creation.

## 2. Install the plugin

Install the published package into a DSH profile:

~~~powershell
# With the DSH CLI:
dsh plugin --profile web add dsh-sessions@0.1.2

# Without the `dsh` CLI:
npm install dsh-sessions@0.1.2
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

Create a child session, then inspect its status and log path:

~~~text
session_create({ "prompt": "Reply with exactly READY and nothing else." })

session_status({ "session_id": "<SESSION_ID>" })

~~~

`session_create` returns a queued result containing the new session ID. Use
that ID with `session_status`. The returned `session_path` is a plain JSONL
file that ordinary `read`, `grep`, or `bash` tools can inspect.

## 4. Agent tools

### Agent tools

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `session_status` | `session_id?`, `recent_n?` | Lists recent sessions, or returns one exact status row with the backend-owned `session_path`. Defaults to the 50 most recently updated sessions. |
| `session_create` | `prompt`, `preset?`, `model?`, `cwd?` | Creates a fresh session and queues its initial prompt. |
| `session_send` | `session_id`, `message`, `mode?` | Sends text to an existing session. `mode` defaults to `steer`; `followup` queues another turn. |

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

No slash commands are registered. Use the agent tools.

## 5. Session lifecycle and delivery

- `session_create` only creates a fresh session and queues its initial prompt;
  it does not wait for model completion.
- `session_send` delivers to a live session or resumes a cold session using its
  stored preset before delivery.
- `session_status` is inspection-only and defaults to 50 recent sessions.
- Session persistence is configured for uncompressed, unpacked JSONL so the
  returned paths are directly readable by ordinary filesystem tools.

## 6. E2E testing

Reusable prompt fixtures are in
[`test/e2e/prompts`](./test/e2e/prompts/). The recommended flow is create,
capture the returned `session_id`, and substitute it into the status prompt.

The exact registered names are required. The session-read fixture is no longer
part of the package; use the returned `session_path` with normal tools.

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
current session; `dsh-sessions` owns cross-session inspection and creation.

## 9. Documentation

- [Session-tree implementation specification](./SPEC.md)
- [Session-tree UI specification](./u.md)
- [E2E prompt fixtures](./test/e2e/prompts/README.md)
