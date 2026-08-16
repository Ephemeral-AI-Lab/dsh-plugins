# DSH Harness Plugins

Plugins for extending [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) with Codex-style agent capabilities.

## Plugin overview

| Plugin | Status | What it does | Documentation |
| --- | --- | --- | --- |
| [`codex-shell`](./codex-shell/) | **Ready** | Adds Codex-compatible `exec_command` and `write_stdin` tools. Agents can start shell commands, keep long-running processes alive, and send input to them later. | [`codex-shell/README.md`](./codex-shell/README.md) |
| [`codex-session-communication`](./codex-session-communication/) | **Under construction** | Adds cross-session tools so an agent can create another DSH session, send it a message, wait for it, inspect its transcript, and list available sessions. | [`codex-session-communication/SPEC.md`](./codex-session-communication/SPEC.md) |

## Plugins

### [`codex-shell`](https://github.com/Ephemeral-AI-Lab/dsh-plugins/tree/main/codex-shell) — Ready

`codex-shell` provides the two shell tools commonly used by Codex-style agents:

- `exec_command` starts a shell command and returns its output. It can leave a long-running process alive.
- `write_stdin` sends input to a running command and polls for more output.

The plugin uses PTY transport by default, with a configured pipe fallback when PTY allocation is unavailable. It is designed for interactive commands and persistent command sessions.

Install it into a DSH profile with:

```bash
dsh plugin --profile web add dsh-codex-shell
```

See the [`codex-shell` README](./codex-shell/README.md) for installation, profile scope, configuration, and troubleshooting.

### [`codex-session-communication`](https://github.com/Ephemeral-AI-Lab/dsh-plugins/tree/main/codex-session-communication) — Under construction

`codex-session-communication` is an experimental cross-session communication plugin. It gives an agent a small set of tools for coordinating with other DSH sessions:

- `create_session({ prompt })` — create a new session and return its `session_id`.
- `send_message_to_session({ session_id, message })` — send a message to an existing session.
- `wait_sessions({ session_ids, ... })` — wait for one or more sessions to make progress or finish.
- `read_session({ session_id, ... })` — read a session's transcript or current state.
- `list_sessions({ ... })` — list sessions visible to the current DSH runtime.

Typical use cases include asking a fresh agent session to handle a separate task, delegating research or implementation work, and reading the result back from the parent session.

The plugin is currently under construction. Its API, persistence behavior, and session lifecycle rules may still change before a stable release. The current design and tool contracts are documented in [`codex-session-communication/SPEC.md`](./codex-session-communication/SPEC.md).

## Repository status

This repository currently contains two plugins:

1. [`codex-shell`](./codex-shell/) — ready for use.
2. [`codex-session-communication`](./codex-session-communication/) — experimental and under construction.

The plugins are intentionally kept outside the DeepSeek Harness source repository. They are installed and composed through DSH's profile and plugin mechanisms.
