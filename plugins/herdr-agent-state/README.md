# herdr-agent-state

A DeepSeek Harness (`dsh`) plugin that reports a pane's agent state — `working`, `blocked`, `idle`,
labeled with the currently-executing tool while working — its session reference and log path, and
its session display facts (title, model, and context usage as pane metadata) to Herdr through
Herdr's pane socket integration. It lets Herdr's sidebar show where the agent actually is, surface
waiting agents, name panes after the conversation, and expose the session for restore, **without any
change to Herdr** (Herdr's custom integration path).

It works in **any dsh frontend** — TUIs, the web app, and headless — because it subscribes only to
documented dsh extension points (agent lifecycle events, the approval and user-question waterfalls)
and carries no UI or renderer dependency.

## Install

The plugin is a **dsh bundle** (`dsh.bundle.patch` → `cordis.patch.yml`), so `dsh plugin add`
activates it automatically — no manual `cordis.patch.yml` edit:

```sh
# from the marketplace index (Mayfly TUI)
/plugin install herdr-agent-state

# or with the dsh CLI, from this repository
dsh plugin --profile <profile> add 'github:Ephemeral-AI-Lab/dsh-plugins#main&path:plugins/herdr-agent-state'

# or from a local checkout
dsh plugin --profile <profile> add /absolute/path/to/dsh-plugins/plugins/herdr-agent-state
```

It inserts a row labelled `herdr-agent-state`. To change the Herdr agent label a frontend reports,
patch the same row id in the profile's `cordis.patch.yml` (an id-targeted patch replaces that row's
whole `config`; the schema defaults fill any field you omit):

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: herdr-agent-state
  config:
    agent: blue        # default dsh; this frontend's own label
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

## Configuration

### Configuration reference

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `agent` | string | `'dsh'` | The Herdr agent label reported for the pane. Set a frontend's own name (e.g. `blue`) so Herdr's sidebar groups it under that label. |
| `source` | string | `'herdr:dsh-agent-state'` | Stable, unique integration source. Herdr attributes the pane's lifecycle authority to this source. **Keep it constant.** Changing it makes Herdr treat the pane as a *different* authority mid-session. |
| `transport` | `'socket'` \| `'cli'` | `'socket'` | How to report to Herdr. Only `socket` is implemented (speaks the pane socket directly). `cli` is declared but not yet implemented — it throws **at load**, so don't set it. |
| `reportSession` | boolean | `true` | Report the pane's session reference (`agent_session_id`) so Herdr can expose it for restore. Set `false` to suppress session reporting. |
| `title` | `'session'` \| `'none'` | `'session'` | Which title to publish as the Herdr pane title (display-only metadata). `session` mirrors the dsh session title — first-prompt fallback, LLM-generated, or pinned by `/rename`; `none` disables title reporting. |
| `message` | `'tool'` \| `'none'` | `'tool'` | Whether to attach a human label to `blocked` reports. `tool` sends the tool name / question summary; `none` sends `blocked` with no message. |
| `workingMessage` | `'tool'` \| `'none'` | `'tool'` | Whether to attach the currently-executing tool name to `working` reports. |
| `tokens` | `'auto'` \| `'none'` | `'auto'` | Report the `model` and `ctx` (context usage `used/window`) tokens as Herdr Agent-sidebar metadata. `none` disables. |
| `stateLabels` | `{ idle?, working?, blocked?, done?, unknown? }` | `{}` | Display text per Herdr state; non-blank entries are sent as pane state labels. |
| `enabled` | boolean | `true` | Kill-switch. Set `false` to disable the reporter in this tree — useful to coexist with another reporter. |

### How to configure it

The plugin is a bundle row labelled `herdr-agent-state`, so it is inserted automatically when you
`dsh plugin add`. Because its `Config` schema gives every field a default, you only set what you
want to change; the schema fills the rest. A profile's `cordis.patch.yml` is a **top-level YAML
array of loader patch entries**, so you target the row by `id` and replace its `config`:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: herdr-agent-state
  config:
    agent: blue
```

The patch replaces the row's whole `config`, so the schema defaults supply any field you don't set.
Include `name` as a guard — if it ever mismatches the row, the patch is skipped with a warning
instead of silently applying:

```yaml
- id: herdr-agent-state
  name: 'herdr-agent-state'
  config:
    agent: blue
    source: herdr:dsh-agent-state
    transport: socket
    reportSession: true
    title: session
    message: tool
    workingMessage: tool
    tokens: auto
    stateLabels:
      idle: ''
      working: ''
      blocked: ''
      done: ''
      unknown: ''
    enabled: true
```

### Examples

Set the Herdr label to `blue` when Blue hosts the pane (all other fields default):

```yaml
- id: herdr-agent-state
  config:
    agent: blue
```

Disable session reporting and verbose blocked messages:

```yaml
- id: herdr-agent-state
  config:
    reportSession: false
    message: none
```

Disable title reporting (keep state and session reports):

```yaml
- id: herdr-agent-state
  config:
    title: none
```

Localize the Herdr state display (state labels):

```yaml
- id: herdr-agent-state
  config:
    stateLabels:
      working: 工作中
      blocked: 等待确认
      idle: 空闲
      done: 已完成
```

Turn off the sidebar tokens while keeping the title:

```yaml
- id: herdr-agent-state
  config:
    tokens: none
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

## Version compatibility

Built against the dsh `0.1.2-alpha` line. It shares the host's `@deepseek-ai/schemastery` instance
(declared as a peer, so the runtime `Config` schema uses the same copy the host validates against).

## Development

```sh
pnpm install
pnpm test         # vitest run (unit + fake-socket integration)
pnpm typecheck
pnpm build        # tsc -> lib/ (committed: git installs fetch sources)
```

`scripts/e2e/tee-proxy.mjs` is an unpublished e2e helper: a tee proxy for the Herdr pane socket that
logs every `pane.report_*` request line while forwarding to the real socket.

## License

MIT.
