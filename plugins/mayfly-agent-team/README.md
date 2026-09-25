# Mayfly Agent Team

[中文](README.zh.md)

An optional `team` preset based on Mayfly's `standard` coding capabilities,
with native Harness teammates, durable peer messages and a shared task board.
The terminal UI provides a searchable roster, task details, overlap notices and
ordinary member-conversation navigation.

## Install and select

Requires Harness **0.1.7-rc.1**, Mayfly and Mayfly UI **0.1.0-alpha.6 or later**
on the 0.1 line. The Mayfly release must include conditional tab visibility and
the public addressed-child reply request. Publish the matching Mayfly release
before enabling this listing in the production marketplace.

```text
/plugin install agent-team
```

Restart Mayfly, create a new session, then select:

```text
/preset team
```

Installation adds a choice. It does not change the default preset, select Team
in an existing session, or add Team tools/policy to ordinary presets.
The normal / plan execution mode remains separate from preset selection.
Explicitly ask the Lead to create teammates and delegate work.

The equivalent package source is:

```sh
dsh plugin --profile mayfly add 'github:Ephemeral-AI-Lab/dsh-plugins#main&path:plugins/mayfly-agent-team'
```

## Terminal workflow

- `/team` shows the roster and readonly task board. Wide layouts display two
  columns; narrow layouts use tabs. Search, focus and selection retain the same
  semantic control identities when resizing. Use the displayed native key hints
  to move between lists and tabs.
- Overlap notices appear in the overview. Open a task for its description,
  owner, blockers and advisory write scopes; open the owner's conversation from
  the detail view. Native Agent tools create and change tasks.
- Choose a member to use Mayfly's exact-Agent conversation view. F7 switches
  the retained Lead/auxiliary view, F8 closes the auxiliary view. Closing does
  not stop the member. Conversation actions offer Team and Reply.
- Reply opens the shared Mayfly form with Queue and Steer. Queue waits for the
  current turn; Steer delivers at a step boundary. Ordinary inline input remains
  queued; use Reply when choosing a delivery mode.
- Cold members first open as history. Press `i` to reply; only Send resumes
  the same addressed member. Drafts survive renderer reload and failed sends.

The UI follows Mayfly's English/Chinese locale. No host terminal objects or
pi-tui imports are used by the plugin.

## Ownership and isolation

`@deepseek-ai/dsh-experimental-agent-team` owns roster, persistence, messages,
task graph and authority. `src/tools.ts` adapts the upstream nine tool schemas
and direct native calls; see `NOTICE`. Plugin admission requires the exact live
Agent to use `team`, and its native Team root to be a real runtime root using
the same preset. This excludes ordinary presets and Workflow one-shot children,
including the period before their subagent descriptor is published.

Tools and commands are retired on preset changes, Agent disposal and plugin
unload. TUI mounts only when Mayfly UI services are available. The plugin owns
no parallel domain store or continuation provider.

`cordis.patch.yml` combines the native service, plugin entry, and a generated
Team declaration. `scripts/sync-preset.mjs` derives that declaration from the
pinned Mayfly `standard` patch, removing only overlapping ordinary delegation
rows. It preserves native `!!js` expressions; no unsupported preset inheritance
API is assumed.

Members share one checkout. Write scopes are advisory, tasks are not
automatically scheduled or released, and the upstream Team domain remains
experimental. Removing the plugin preserves logs but removes the preset from
new-session selection. Reinstall before resuming saved `team` sessions; do not
silently replace their recorded preset.

## Development

After the required Mayfly version is published:

```sh
pnpm install
pnpm preset:check
pnpm typecheck
pnpm test:coverage
pnpm build
```

Before publication, build the matching Mayfly checkout and use its actual
tarballs for a consumer check:

```sh
node scripts/with-mayfly.mjs /absolute/path/to/mayfly -- pnpm run check
```

The helper temporarily substitutes packed Mayfly dependencies, including the
transitive UI dependency, and restores manifests and the lockfile afterward.
It creates no profile and does not rebuild the supplied Mayfly checkout.
`lib/` is committed for GitHub installs. Marketplace `dist/` is workflow-owned.

Tests exercise real native presets/Agents, all nine tools, fresh/fork creation,
task revision rejection, retained continuation, ordinary-preset isolation,
TUI lifetime and public-compiler width scans. They use temporary session stores
and a local in-process mock adapter; no profile or network model is used.
