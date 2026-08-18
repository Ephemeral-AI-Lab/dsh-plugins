# dsh-sessions

Session discovery and creation for DeepSeek Harness.

## Release: 0.1.0

The first npm release provides read-only session status and message inspection,
fresh-session creation, and the `/sessions` command interface.

## Install

Install the published package with npm:

```powershell
npm install dsh-sessions@0.1.0
```

Or add it to a DSH profile with the DSH CLI:

```powershell
dsh plugin --profile web add dsh-sessions@0.1.0
```

Restart DSH and create a new session after installing the plugin.

It provides:

- `session_status({ session_id?, recent_n? })` for recent session status or one exact session;
- `session_read({ session_id, offset?, limit? })` for bounded reconstructed message reads;
- `session_create({ prompt, preset?, model?, cwd? })` for a fresh session with an initial prompt;
- `session_send({ session_id, message, mode? })` for steering or following up an existing session;
- `/sessions status [SESSION_ID] [--recent N]`,
  `/sessions read SESSION_ID [--offset N] [--limit N]`, and
  `/sessions create PROMPT [--preset ID] [--provider PROVIDER --model MODEL] [--effort LEVEL] [--cwd PATH]`,
  `/sessions send SESSION_ID MESSAGE [--mode steer|followup]`
  for human-readable views, session creation, and message delivery.

The slash command syntax is:

```text
/sessions status [SESSION_ID] [--recent N]
/sessions read SESSION_ID [--offset N] [--limit N]
/sessions send SESSION_ID MESSAGE [--mode steer|followup]
```

`session_status` returns the 50 most recently updated sessions by default. Pass
`recent_n` to change that count, or pass `session_id` to inspect one exact
session. The exact-session form still returns a `sessions` array containing one
row; a missing ID is reported with status `missing`.

`session_create` queues the initial prompt and returns as soon as the new
session accepts it. `preset` and `model` are optional: they inherit from the
calling agent when present, otherwise the deployment defaults are used. An
explicit model is `{ provider, model, reasoningEffort? }`; the effort is an
adapter-owned identifier validated against the selected model. `cwd` optionally
binds the session to an existing absolute directory. A child inherits the
caller's `cwd` when neither is supplied. When using the slash command,
`--provider PROVIDER --model MODEL --effort LEVEL` supplies the tool's nested
`model` object; a JSON object with the tool argument shape is also accepted
after `/sessions create`.

`session_read` uses a 1-based message-block `offset` and defaults `limit` to
200 message blocks. It reconstructs the canonical conversation surface, so
token deltas, chunks, lifecycle events, and other trace-only records are not
returned. The output is grouped into `[USER]`, `[CONTEXT]`, `[ASSISTANT]`, and
`[TOOL]` blocks without XML or generated line numbers; the footer reports the
returned range and total message count.

`session_send` delivers to a live or explicitly resumed session. Its `mode`
defaults to `steer`, which wakes idle agents and targets the nearest step of a
running agent; `followup` queues a separate next turn.

The equivalent slash command is `/sessions send SESSION_ID MESSAGE`; quote the
message when it contains spaces. Use `--mode followup` to queue an ordinary
next turn instead of the default steering delivery.

The plugin reads persisted headers, live agents, and durable titles. It never
resumes a cold session for inspection and never triggers title generation. It
owns session inspection, creation, and message delivery. The legacy
`codex-session-communication` plugin should only be composed for
`wait_sessions` until it is removed.

In the message composer, entering `/sessions read SESSION_ID` opens a small
argument-completion popup with the unused `--offset` and `--limit` options.
Selecting an option inserts it into the draft with a trailing space so its
numeric value can be entered immediately. A partially typed option is filtered
and replaced when selected; the draft is never sent while the popup is shown.
The local hint matcher ignores leading, trailing, and repeated whitespace
between `/sessions` and its subcommand.

## Verify locally

Run the package checks and build the published artifacts:

```powershell
pnpm typecheck
pnpm test -- --runInBand
pnpm build
```

The npm package includes the generated `lib` directory, the plugin manifest
patch, and this README. The development dependencies are not included in the
published package.

## Package scope

The plugin uses public DeepSeek Harness and Cordis APIs. It does not modify
DeepSeek Harness source code. Session messaging and waiting remain owned by the
companion `codex-session-communication` plugin.
