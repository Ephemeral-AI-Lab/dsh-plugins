# herdr-agent-state: implementation contract

This document records the runtime contract the plugin implements: which dsh
extension points it observes, what it sends on the Herdr pane socket, and the
ordering/clearing rules Herdr relies on.

## Scope and activation

- Cordis function plugin (`name` / `inject` / `Config` / `apply`), no injected
  services (`inject = []`); optional services are read with `ctx.get`.
- Bundle row `id: herdr-agent-state`, `name: herdr-agent-state`; every
  `config` field has a schema default so a patch supplies only overrides.
- Strict no-op unless `HERDR_ENV=1` **and** `HERDR_SOCKET_PATH` **and**
  `HERDR_PANE_ID` are all present. `enabled: false` also no-ops.
  `transport: 'cli'` throws at load (declared, unimplemented).

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

## Release semantics

Herdr evaluates the `source`/`agent`/`applies_to_source` guards at report
arrival, not continuously — so on release the reporter must explicitly clear
every guarded kind it sent and every token key it sent, then release the
pane's lifecycle authority. A second `release()` is a no-op for the metadata
clear and resends only `pane.release_agent`.
