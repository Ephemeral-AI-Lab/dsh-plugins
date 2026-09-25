# dsh-herdr-plus: implementation contract

This document records the runtime contract the plugin implements: which dsh
extension points it observes, what it sends on the Herdr pane socket, the
skill/tools it optionally contributes, and the ordering/clearing rules Herdr
relies on.

## Scope and activation

- Cordis function plugin (`name` / `inject` / `Config` / `apply`), no injected
  services (`inject = []`); optional services are read with `ctx.get`.
- Bundle row `id: dsh-herdr-plus`, `name: dsh-herdr-plus`; every `config`
  field has a schema default so a patch supplies only overrides.
- Strict no-op unless `HERDR_ENV=1` **and** `HERDR_SOCKET_PATH` **and**
  `HERDR_PANE_ID` are all present. `enabled: false` also no-ops.
  `transport: 'cli'` throws at load (declared, unimplemented).
- Feature matrix after the environment gate: `skill` × presence of the
  `ctx.skills` service, `tools` × presence of the `ctx.tools` service. An
  absent service disables that feature silently; the reporter is unaffected.
  `src/tools.ts` is loaded via dynamic `import()` so a profile without the
  `dsh-tools` package still loads the plugin.

## Signal → state mapping

| Herdr state | dsh signal |
| --- | --- |
| `working` | `agent/status` reports `running` for any live agent |
| `blocked` | `approval/request` or `user-questions/request` waterfall open |
| `idle` | neither of the above |

- `agent/disposed` removes the agent from the running set.
- `tools/execute` records `callId → name` for the working `message`;
  `tools/result` and the waterfall's `finally` both close the call id
  (idempotent). Denied calls never reach `tools/execute`, so they never label.
- Blocked and question waterfalls are passive: `await next()` in `try/finally`,
  the downstream decision is returned unchanged.
- `questionLabel` uses the leading item's `header ?? question`, suffixed with
  `(+N more)` when the request carries extra questions.

## Wire contract (Herdr pane socket)

One newline-delimited JSON request per call, fresh connection per request,
fire-and-forget (`sendRequest` resolves on write flush, 500ms first timeout,
1500ms retry, never throws/rejects into the host).

- `pane.report_agent` — `{ pane_id, source, agent, state, message?, seq,
  agent_session_id?, agent_session_path? }`. Burst-coalesced latest-wins via a
  single-flight queue; `seq` is strictly increasing (`Date.now() * 1000` base).
- `pane.report_agent_session` — `{ pane_id, source, agent, seq,
  session_start_source?, agent_session_id, agent_session_path? }`. Sent once
  per `agent/session-start` when `reportSession` and a session id exist.
  `agent_session_path` is the absolute jsonl path from
  `sessionPersistence.locate(header)` when the backend reports `kind: 'jsonl'`.
- `pane.report_metadata` — display-only fields: `title`, `tokens`
  (`{ model?, ctx? }`, key-level patch where `null` clears), `state_labels`.
  Title and state labels additionally carry `agent` + `applies_to_source`
  guards; tokens do not. Per-kind dedupe; one request per changed set.
- `pane.release_agent` — `{ pane_id, source, agent }` on unload
  (`ctx.effect` disposer) and `beforeExit`, preceded by one clearing
  `pane.report_metadata` (`clear_title`, `clear_state_labels`, `tokens: {k:
  null}`) covering exactly the kinds previously sent.

## Session facts pipeline

`agent/session-start`:

1. `setSessionId(header.id)`, `setSessionPath(locate().path)` on the reporter.
2. `reportSession(source)`, `publish(force)` — the authority claim precedes
   guarded metadata.
3. `factsModel.setSession(id, { title?, model?, contextWindow?, usedTokens? })`
   — title from `sessionTitle.get(session)`, the rest seeded from the replayed
   log (`findLast` over `request/header`, `request/context`,
   `assistant/message`); `state_labels` ride the same request when configured.

`session/event` feed (post-commit): only `session/title`, `request/header`,
`request/context`, `assistant/message` for the tracked session id are folded;
a usage-less `assistant/message` keeps the previous occupancy. The first
observed session is adopted when none was recorded (mid-session reload).

`ctx` renders `used/window` mirroring the dsh TUI status bar (`34k/1.0M`);
occupancy is `inputTokens + cacheReadTokens + cacheWriteTokens` (disjoint
counts; `inputTokens` is the anchor). Bare `used` when the route's window is
unknown.

## `herdr` skill provider

When `skill !== 'none'` and `ctx.get('skills')` is defined, `apply` registers
a provider (`name: 'dsh-herdr-plus'`) via `ctx.effect` so fiber disposal
unregisters it.

- Candidate: `{ name: 'herdr', source: 'bundled', rank: 600
  (BUNDLED_SKILL_RANK), locator: null, invocation: model+user, resourceBase:
  <pkg>/skills }`; `list()` is synchronous-shaped (no subprocess).
- `get()` loads the body lazily. `auto` mode runs `herdr --skill` (5s timeout,
  output must mention `HERDR_ENV`); any failure or `bundled` mode reads the
  vendored `skills/herdr/SKILL.md`. The YAML frontmatter is stripped and
  `skills/dsh-sessions.md` (sibling-session addendum) is appended. If the
  vendored file is also missing, `get()` returns `undefined` — the skill is
  simply absent from catalogs.
- The addendum is the part Herdr's own skill cannot cover: `agent start
  --kind` has no `dsh`/`mayfly` kind and `agent prompt`/`agent send-keys`/
  `agent explain` reject custom-reported panes, so sibling sessions are
  orchestrated over the pane surface (`pane split` → `pane run` → poll
  `agent get` → `agent rename`; `pane send-text`/`send-keys`/`read`;
  `agent wait`).

## `herdr_agent_*` tools

When `tools === 'auto'` and `ctx.get('tools')` is defined, `apply` dynamically
imports `src/tools.ts` and registers four `defineTool` tools; their disposers
are held by a `ctx.effect` so unload unregisters them (the registry binds
registrations to the service's own context, not the plugin fiber).

CLI conventions (verified against herdr 0.8.2): success prints
`{id, result}` JSON on stdout; failures print `{id, error:{code,message}}` on
stderr with exit 1; `pane run`, `pane send-text`, `pane send-keys`, and
`agent rename` print nothing on success; `pane read` prints raw terminal text.
`cli.ts` normalizes all of this into discriminated results that never throw.

| Tool | Contract |
| --- | --- |
| `herdr_agent_spawn` | `pane split --current --direction <d> --cwd <cwd> --no-focus` → `.result.pane.pane_id`; poll `pane read --source visible` until the shell prompt renders (10s); `pane run "<launchCommand> '<task>'"` (task single-quoted, `'`→`'"'"'`); poll `agent get` up to 20s for the sibling's reporter; optional `agent rename`. Returns `{ pane_id, registered, agent?, agent_status?, name? }` — `registered: false` means the pane is live but nothing claimed it (e.g. the sibling profile lacks this plugin). |
| `herdr_agent_prompt` | `agent get <target>` resolves names and pane ids to a pane; `blocked` status refuses the send. Otherwise `pane send-text` + `pane send-keys enter`; `wait: true` appends an `agent wait` (idle/done/blocked, `timeout_ms` default 120s) and returns the settled `status`. |
| `herdr_agent_wait` | `agent wait <target>`; `--until` repeats per requested state, `--timeout` defaults to 120s. Herdr's `timeout` error code maps to `{ status: 'timeout', matched: false }`. |
| `herdr_agent_read` | Resolves the target via `agent get`, falling back to `pane get` when the target is pane-id shaped and has no agent (so unregistered panes remain readable); then `pane read --source <s> --lines <n>` and returns `{ pane_id, source, content }` with the raw text as the rendered content. |

The launch command is `config.launchCommand` (default `mayfly`), never a tool
argument — the model supplies only `task`, `name`, `cwd`, `direction`.

## Release semantics

Herdr evaluates the `source`/`agent`/`applies_to_source` guards at report
arrival, not continuously — so on release the reporter must explicitly clear
every guarded kind it sent and every token key it sent, then release the
pane's lifecycle authority. A second `release()` is a no-op for the metadata
clear and resends only `pane.release_agent`.
