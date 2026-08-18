# dsh-sessions

Read-only session discovery for DeepSeek Harness.

It provides:

- `list_sessions({ limit? })` for agent-facing session selection;
- `check_session_status({ session_id })` for one exact session;
- `read_session({ session_id, offset?, limit? })` for bounded reconstructed message reads;
- `/sessions list [--limit N]`, `/sessions status SESSION_ID`, and
  `/sessions read SESSION_ID [--offset N] [--limit N]` for human-readable views.

The slash command syntax is:

```text
/sessions list [--limit N]
/sessions status SESSION_ID
/sessions read SESSION_ID [--offset N] [--limit N]
```

`read_session` uses a 1-based message-block `offset` and defaults `limit` to
200 message blocks. It reconstructs the canonical conversation surface, so
token deltas, chunks, lifecycle events, and other trace-only records are not
returned. The output is grouped into `[USER]`, `[CONTEXT]`, `[ASSISTANT]`, and
`[TOOL]` blocks without XML or generated line numbers; the footer reports the
returned range and total message count.

The plugin reads persisted headers, live agents, and durable titles. It never
resumes a cold session and never triggers title generation. Do not compose it
alongside another plugin that registers `list_sessions`, such as the current
`codex-session-communication` package, until that duplicate registration is
removed or consolidated.

In the message composer, entering `/sessions read SESSION_ID` opens a small
argument-completion popup with the unused `--offset` and `--limit` options.
Selecting an option inserts it into the draft with a trailing space so its
numeric value can be entered immediately. A partially typed option is filtered
and replaced when selected; the draft is never sent while the popup is shown.
The local hint matcher ignores leading, trailing, and repeated whitespace
between `/sessions` and its subcommand.
