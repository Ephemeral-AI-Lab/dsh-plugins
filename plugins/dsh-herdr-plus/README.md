# dsh-herdr-plus

A DeepSeek Harness (`dsh`) plugin that integrates a pane with Herdr:

- **Reports** the pane's agent state — `working`, `blocked`, `idle`, labeled with the
  currently-executing tool while working — its session reference and log path, and its session
  display facts (title, model, and context usage as pane metadata) to Herdr through Herdr's pane
  socket integration. Herdr's sidebar shows where the agent actually is, surfaces waiting agents,
  names panes after the conversation, and exposes the session for restore, **without any change to
  Herdr** (Herdr's custom integration path).
- **Contributes a `herdr` skill** (opt-out via `skill: 'none'`) — Herdr's own `SKILL.md`, preferring
  the installed binary's `herdr --skill` output so the instructions always match the deployed
  version, plus a bundled fallback and a sibling-session addendum that teaches the model how to
  launch and drive additional dsh/Mayfly sessions in their own panes.
- **Registers `herdr_agent_*` tools** (opt-out via `tools: 'none'`) that wrap the sibling-session
  recipe as single structured calls instead of multi-step shell pipelines.

It works in **any dsh frontend** — TUIs, the web app, and headless — because it subscribes only to
documented dsh extension points (agent lifecycle events, the approval and user-question waterfalls)
and carries no UI or renderer dependency.

## Install

The plugin is a **dsh bundle** (`dsh.bundle.patch` → `cordis.patch.yml`), so `dsh plugin add`
activates it automatically — no manual `cordis.patch.yml` edit:

```sh
# from the marketplace index (Mayfly TUI)
/plugin install dsh-herdr-plus

# or with the dsh CLI, from this repository
dsh plugin --profile <profile> add 'github:Ephemeral-AI-Lab/dsh-plugins#main&path:plugins/dsh-herdr-plus'

# or from a local checkout
dsh plugin --profile <profile> add /absolute/path/to/dsh-plugins/plugins/dsh-herdr-plus
```

It inserts a row labelled `dsh-herdr-plus`. To change the Herdr agent label a frontend reports,
patch the same row id in the profile's `cordis.patch.yml` (an id-targeted patch replaces that row's
whole `config`; the schema defaults fill any field you omit):

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-herdr-plus
  config:
    agent: blue        # default mayfly; this frontend's own label
```

The plugin is a strict no-op outside a Herdr pane (`HERDR_ENV=1` plus `HERDR_SOCKET_PATH` and
`HERDR_PANE_ID` absent), so it never adds side effects to a normal terminal session.

## How it reports state

| Herdr state | dsh signal |
| --- | --- |
| `working` | any agent reports `agent/status = running` |
| `blocked` | an `approval/request` or `user-questions/request` waterfall is awaiting an answer |
| `idle` | no agent running and nothing pending |

While working, the pane report carries a `message` naming the currently-executing tool (observed on
the `tools/execute` waterfall, which fires only for calls that survived approval — denied calls
never label). The session reference carries both `agent_session_id` and, when the profile persists
sessions as jsonl, `agent_session_path` (the absolute log path); sqlite or no-persistence backends
omit the path.

Blocked observations are **passive**: the plugin calls `await next()` and returns the downstream
decision unchanged, so approval and question flows are never altered. Reports are coalesced (latest
value wins) and tagged with a strictly increasing `seq`, mirroring Herdr's own Pi integration wire
contract.

The plugin releases the pane's lifecycle authority on unload and process exit, and re-reports on
`agent/session-start` so a reload does not leave Herdr with a stale authority.

## How it reports metadata

All display-only extras ride Herdr's `pane.report_metadata` channel. Title and state labels are
presentation fields guarded by the same `source`/`agent` as the state reports plus an
`applies_to_source` guard, so they apply exactly while this reporter holds the pane's lifecycle
authority; tokens always apply and are this reporter's to clear. Herdr checks the guards when a
report arrives (not continuously), so the reporter clears everything it sent when it releases the
pane's authority. Metadata never affects waits, notifications, or rollups, and is not restored
across a Herdr server restart.

- **Title** (`title: session`) mirrors the dsh session title — first-prompt fallback, LLM-generated
  refinement, or pinned by `/rename`. Titles are observed on the same `session/title` session-log
  feed the dsh TUI renders, filtered to the session the pane's agent is running (subagent sessions
  in the same process are skipped); a resumed session's existing title is read directly at
  `agent/session-start`, since past title events are replay seeds that never re-enter the live feed.
  After a `/clear` the previous title stays until the new session produces its first title (usually
  seconds).
- **Tokens** (`tokens: auto`) report `model` (the raw model id) and `ctx` (context occupancy,
  `used/window` mirroring the dsh TUI status bar, e.g. `34k/1.0M`; bare `used` when the route's
  context window is unknown). Model and window come from the `request/header` / `request/context`
  log events and update on every assistant step's usage; a resumed session seeds all three from the
  replayed log. Herdr's Agent sidebar can render them as `$model` and `$ctx`. Tokens are cleared on
  release.
- **State labels** (`stateLabels`) override the visible text per Herdr state — for example `{
  working: 工作中, blocked: 等待确认 }`. Non-blank entries are sent once per session start and
  cleared on release.
- **Working message** (`workingMessage: tool`) attaches the currently-executing tool name to
  `working` state reports (see above); blocked labels are unchanged and still governed by `message`.

## The `herdr` skill

With `skill: 'auto'` (the default) and a profile that mounts the skills service, the plugin
registers a provider that contributes the `herdr` skill — so `skill("herdr")` and explicit user
invocation load it like any other skill:

- `auto` runs `herdr --skill` at load time, so the body always matches the installed Herdr version;
  any failure (missing binary, timeout, malformed output) falls back to the vendored copy in
  `skills/herdr/SKILL.md`.
- `bundled` serves only the vendored copy and never spawns a subprocess.
- `none` registers nothing — the plugin stays a pure state reporter.

The served body appends `skills/dsh-sessions.md`, a sibling-session addendum covering what the
upstream skill cannot know: dsh/Mayfly is not a built-in Herdr agent kind (`agent start --kind` and
`agent prompt`/`agent send-keys`/`agent explain` do not apply to custom-reported panes), so siblings
are launched with `pane split` + `pane run "<launchCommand> '<task>'"` — `mayfly` accepts its first
task as a positional argument, so the prompt arrives with the process launch — and driven with
`pane send-text`/`pane send-keys`/`pane read` plus `agent wait`/`agent rename`.

A user-installed `herdr` skill (for example via `npx skills add herdrdev/herdr`) ranks below bundled
entries, so it wins over this provider — the plugin only fills the gap when nothing else supplies
the skill.

## The `herdr_agent_*` tools

With `tools: 'auto'` (the default) and a profile that mounts the tools service, the plugin
registers four model-facing tools that wrap the sibling-session recipe as structured calls:

| Tool | Purpose |
| --- | --- |
| `herdr_agent_spawn` | Split a sibling pane (`--no-focus`), run `launchCommand` with the task as one quoted argv word, wait for the sibling's own reporter to claim the pane, optionally rename it. Returns `{ pane_id, registered, agent?, agent_status?, name? }`. |
| `herdr_agent_prompt` | Type a follow-up prompt into a sibling's pane and submit it. Refuses while the target is `blocked` on its own approval/question. Optional `wait` settles idle/done/blocked. |
| `herdr_agent_wait` | Wait until an agent reaches a requested state (default: idle/done/blocked); a Herdr timeout returns `{ status: 'timeout', matched: false }` instead of failing. |
| `herdr_agent_read` | Read a sibling's pane output (`visible` / `recent` / `recent-unwrapped` / `detection`). Agent names resolve through `agent get`; bare pane ids still work. |

All tools shell out to the Herdr binary (`HERDR_BIN_PATH`, else `herdr` on `PATH`), normalize its
JSON-envelope / exit-1 error contract, and forward cancellation. `herdr_agent_spawn` never accepts a
free-form command — the launch line is the `launchCommand` config field, and the model supplies only
the task text, name, cwd, and split direction.

## Configuration

### Configuration reference

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `agent` | string | `'mayfly'` | The Herdr agent label reported for the pane. Set a frontend's own name (e.g. `blue`) so Herdr's sidebar groups it under that label. |
| `source` | string | `'herdr:dsh-herdr-plus'` | Stable, unique integration source. Herdr attributes the pane's lifecycle authority to this source. **Keep it constant.** Changing it makes Herdr treat the pane as a *different* authority mid-session. |
| `transport` | `'socket'` \| `'cli'` | `'socket'` | How to report to Herdr. Only `socket` is implemented (speaks the pane socket directly). `cli` is declared but not yet implemented — it throws **at load**, so don't set it. |
| `reportSession` | boolean | `true` | Report the pane's session reference (`agent_session_id`) so Herdr can expose it for restore. Set `false` to suppress session reporting. |
| `title` | `'session'` \| `'none'` | `'session'` | Which title to publish as the Herdr pane title (display-only metadata). `session` mirrors the dsh session title — first-prompt fallback, LLM-generated, or pinned by `/rename`; `none` disables title reporting. |
| `message` | `'tool'` \| `'none'` | `'tool'` | Whether to attach a human label to `blocked` reports. `tool` sends the tool name / question summary; `none` sends `blocked` with no message. |
| `workingMessage` | `'tool'` \| `'none'` | `'tool'` | Whether to attach the currently-executing tool name to `working` reports. |
| `tokens` | `'auto'` \| `'none'` | `'auto'` | Report the `model` and `ctx` (context usage `used/window`) tokens as Herdr Agent-sidebar metadata. `none` disables. |
| `skill` | `'auto'` \| `'bundled'` \| `'none'` | `'auto'` | Contribute the `herdr` skill via `ctx.skills`. `auto` prefers `herdr --skill`; `bundled` serves only the vendored copy; `none` registers nothing. |
| `tools` | `'auto'` \| `'none'` | `'auto'` | Register the `herdr_agent_*` orchestration tools on `ctx.tools`. `none` registers nothing. |
| `launchCommand` | string | `'mayfly'` | Command line `herdr_agent_spawn` runs in the sibling pane; the task is appended as one shell-quoted argv word. |
| `stateLabels` | `{ idle?, working?, blocked?, done?, unknown? }` | `{}` | Display text per Herdr state; non-blank entries are sent as pane state labels. |
| `enabled` | boolean | `true` | Kill-switch. Set `false` to disable the reporter in this tree — useful to coexist with another reporter. |

### How to configure it

The plugin is a bundle row labelled `dsh-herdr-plus`, so it is inserted automatically when you
`dsh plugin add`. Because its `Config` schema gives every field a default, you only set what you
want to change; the schema fills the rest. A profile's `cordis.patch.yml` is a **top-level YAML
array of loader patch entries**, so you target the row by `id` and replace its `config`:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-herdr-plus
  config:
    agent: blue
```

The patch replaces the row's whole `config`, so the schema defaults supply any field you don't set.
Include `name` as a guard — if it ever mismatches the row, the patch is skipped with a warning
instead of silently applying:

```yaml
- id: dsh-herdr-plus
  name: 'dsh-herdr-plus'
  config:
    agent: blue
    source: herdr:dsh-herdr-plus
    transport: socket
    reportSession: true
    title: session
    message: tool
    workingMessage: tool
    tokens: auto
    skill: auto
    tools: auto
    launchCommand: mayfly
    stateLabels:
      idle: ''
      working: ''
      blocked: ''
      done: ''
      unknown: ''
    enabled: true
```

### Examples

Keep only the state reporting — no skill, no tools:

```yaml
- id: dsh-herdr-plus
  config:
    skill: none
    tools: none
```

Serve the skill but never spawn `herdr --skill` (vendored copy only):

```yaml
- id: dsh-herdr-plus
  config:
    skill: bundled
```

Launch siblings with a different dsh profile instead of the `mayfly` binary:

```yaml
- id: dsh-herdr-plus
  config:
    launchCommand: 'dsh --profile mayfly'
```

Set the Herdr label to `blue` when Blue hosts the pane (all other fields default):

```yaml
- id: dsh-herdr-plus
  config:
    agent: blue
```

Disable session reporting and verbose blocked messages:

```yaml
- id: dsh-herdr-plus
  config:
    reportSession: false
    message: none
```

Localize the Herdr state display (state labels):

```yaml
- id: dsh-herdr-plus
  config:
    stateLabels:
      working: 工作中
      blocked: 等待确认
      idle: 空闲
      done: 已完成
```

### Notes

- **Changing `source`** re-attributes the pane's authority in Herdr. Keep it at the default unless
  you are deliberately running two reporters in the same tree — then give each a distinct `source`,
  and use `enabled: false` on the one you want silent.
- **`transport: 'cli'` is not implemented.** Setting it throws during plugin load (fail-fast), so
  leave it as `socket`.
- **`config` is validated** against the schemastery schema at load; an invalid value (for example a
  `transport` that isn't `socket`/`cli`) is rejected, and the plugin fails to load rather than
  running half-configured.
- The pane title and state labels ride the same `source` and `agent` guards as the state reports;
  changing `source` mid-session affects them the same way it affects lifecycle authority. Tokens are
  not guarded — they always apply — so this reporter clears them on release.
- Because a patch replaces the row's whole `config`, any field you don't set comes from the schema
  default — you do not need to copy every field.
- The skill only becomes model-visible when the profile composes the skills service **and** the
  `skill` tool (`tool-skill`, part of the standard preset); the tools require the `ctx.tools`
  service. Both are optional at runtime: when a service is absent the plugin stays a pure reporter.
- Upstream path for full native support (`agent start --kind`, `agent prompt`, `agent send-keys`):
  Herdr needs a compiled-in `dsh`/`mayfly` agent kind and detection manifest — that requires a
  Herdr-side change and is out of scope for this plugin.

## Version compatibility

Built against the dsh `0.1.2-alpha` line. It shares the host's `@deepseek-ai/schemastery` instance
(declared as a peer, so the runtime `Config` schema uses the same copy the host validates against).
The `dsh-tools` import for the orchestration tools is loaded dynamically, so a profile without the
tools package still loads the reporter.

## Development

```sh
pnpm install
pnpm test         # vitest run (unit + fake-socket/fake-CLI integration)
pnpm typecheck
pnpm build        # tsc -> lib/ (committed: git installs fetch sources)
```

`scripts/e2e/tee-proxy.mjs` is an unpublished e2e helper: a tee proxy for the Herdr pane socket that
logs every `pane.report_*` request line while forwarding to the real socket.

## License

MIT.
