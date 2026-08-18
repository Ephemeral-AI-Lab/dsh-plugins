# dsh-sessions

Session discovery and creation for DeepSeek Harness.

It provides:

- `list_status({ session_id?, recent_n? })` for recent session status or one exact session;
- `read_session({ session_id, offset?, limit? })` for bounded reconstructed message reads;
- `create_session({ prompt, preset?, model?, cwd? })` for a fresh session with an initial prompt;
- `/sessions status [SESSION_ID] [--recent N]`,
  `/sessions read SESSION_ID [--offset N] [--limit N]`, and
  `/sessions create PROMPT [--preset ID] [--model PROVIDER/MODEL] [--effort LEVEL] [--cwd PATH]`
  for human-readable views and session creation.

The slash command syntax is:

```text
/sessions status [SESSION_ID] [--recent N]
/sessions read SESSION_ID [--offset N] [--limit N]
```

`list_status` returns the 50 most recently updated sessions by default. Pass
`recent_n` to change that count, or pass `session_id` to inspect one exact
session. The exact-session form still returns a `sessions` array containing one
row; a missing ID is reported with status `missing`.

`create_session` queues the initial prompt and returns as soon as the new
session accepts it. `preset` and `model` are optional: they inherit from the
calling agent when present, otherwise the deployment defaults are used. An
explicit model is `{ provider, model, reasoningEffort? }`; the effort is an
adapter-owned identifier validated against the selected model. `cwd` optionally
binds the session to an existing absolute directory. A child inherits the
caller's `cwd` when neither is supplied. When using the slash command,
`--model PROVIDER/MODEL --effort LEVEL` is shorthand for the tool's nested
`model` object; a JSON object with the tool argument shape is also accepted
after `/sessions create`.

`read_session` uses a 1-based message-block `offset` and defaults `limit` to
200 message blocks. It reconstructs the canonical conversation surface, so
token deltas, chunks, lifecycle events, and other trace-only records are not
returned. The output is grouped into `[USER]`, `[CONTEXT]`, `[ASSISTANT]`, and
`[TOOL]` blocks without XML or generated line numbers; the footer reports the
returned range and total message count.

The plugin reads persisted headers, live agents, and durable titles. It never
resumes a cold session and never triggers title generation. It owns session
inspection and creation; `codex-session-communication` should be composed only
for `send_message_to_session` and `wait_sessions`.

In the message composer, entering `/sessions read SESSION_ID` opens a small
argument-completion popup with the unused `--offset` and `--limit` options.
Selecting an option inserts it into the draft with a trailing space so its
numeric value can be entered immediately. A partially typed option is filtered
and replaced when selected; the draft is never sent while the popup is shown.
The local hint matcher ignores leading, trailing, and repeated whitespace
between `/sessions` and its subcommand.
