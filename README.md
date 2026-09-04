# 🧩 Mayfly / DSH Plugin Marketplace

<p align="center">
  <img src="./assets/whale-boy.png" alt="Whale Boy icon" width="220">
</p>

<p align="center">
  The official plugin marketplace for <a href="https://github.com/Ephemeral-AI-Lab/mayfly">Mayfly</a> and
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness (dsh)</a>:
  Ephemeral AI Lab's own plugins (source in this repo), curated dsh optional
  plugins, and community submissions.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square" alt="MIT License"></a>
</p>

Two things live here:

1. **`plugins/`** — the source of Ephemeral AI Lab's official plugins.
2. **`registry/`** — the marketplace: one JSON manifest per listing. CI
   aggregates them into [`dist/index.json`](./dist/index.json), the document
   Mayfly's `/plugin` command and the website catalog consume.

## ⚡ Installing plugins

In Mayfly (TUI):

```
/plugin                 # browse, search, inspect, install, remove
/plugin install <id>    # e.g. /plugin install loop
```

Or with the dsh CLI directly (works for any profile):

```sh
# npm source
dsh plugin --profile mayfly add @deepseek-ai/dsh-terminal-bash @deepseek-ai/dsh-tool-terminal

# GitHub source (monorepo subdirectories work; pinned refs preferred)
dsh plugin --profile mayfly add 'github:Ephemeral-AI-Lab/dsh-plugins#main&path:plugins/loop'
```

Restart the profile and start a new session after installing. Entries with
`activation: profile-patch` additionally need their rows in the profile's
`cordis.patch.yml` — the `/plugin` command does this for you; see
[docs/market.md](./docs/market.md#activation) for the manual path.

## 📦 Current listings

| id | source | surfaces | what it adds |
| --- | --- | --- | --- |
| [`codex-terminal`](./registry/official/codex-terminal.json) | official | server | Codex-style persistent shell: `exec_command` / `write_stdin` |
| [`loop`](./registry/official/loop.json) | official | server · web | Recurring prompts & alarms: `loop_*` tools, `/loop`, Web panel |
| [`mock`](./registry/official/mock.json) | official | server · web | Deterministic mock model turns: `/mock run` / `replay` (unstable) |
| [`sessions`](./registry/official/sessions.json) | official | server | Multi-session orchestration: `session_status/create/send` tools |
| [`coding-plan`](./registry/official/coding-plan.json) | official | server | Reuse `codex login` / `grok login` subscriptions as providers |
| [`preset-builder`](./registry/official/preset-builder.json) | official | web | Preset details page in dsh Web Settings |
| [`workbench-ui`](./registry/official/workbench-ui.json) | official | web | The Web workbench frame other panels dock into |
| [`sidechat`](./registry/official/sidechat.json) | official | server · web | Side-chat panel on the Web workbench (needs workbench-ui) |
| [`terminal`](./registry/dsh/terminal.json) | dsh | server | PTY terminal: `terminal_open/send/read/signal/close/list` |
| [`lsp`](./registry/dsh/lsp.json) | dsh | server | Read-only `lsp` navigation tool |
| [`mcp`](./registry/dsh/mcp.json) | dsh | server | MCP client: `mcp__server__tool` external tools |
| [`acp`](./registry/dsh/acp.json) | dsh | server | Agent Client Protocol server |
| [`code-runtime-ts`](./registry/dsh/code-runtime-ts.json) | dsh | server | `run_code` TypeScript worker-thread runtime |
| [`code-runtime-py`](./registry/dsh/code-runtime-py.json) | dsh | server | `run_code` Python runtime |

`server` plugins work in any frontend (tools render generically); `web` adds a
dsh Web client module; `tui` adds Mayfly-native UI. A plugin is useful in a
given frontend if it has `server` **or** that frontend's own contribution.

## 📥 Submitting a plugin

Published an npm package (or a GitHub repo with committed build output)?
Submit a listing:

1. Read [`registry/community/README.md`](./registry/community/README.md).
2. Copy [`registry/submission-template.json`](./registry/submission-template.json)
   to `registry/community/<slug>.json` and open a PR.
3. CI scratch-installs every declared source; a maintainer reviews against the
   [review checklist](./registry/review-checklist.md).

The manifest spec is [`docs/market.md`](./docs/market.md) — manifests are
**discovery/install metadata only**; the runtime contract is still your
package plus its `cordis.patch.yml`.

## 🛠️ Repository scripts

```sh
node scripts/validate-manifests.mjs   # schema + semantics, zero deps
node scripts/verify-packages.mjs      # npm tarball + GitHub scratch-install checks
node scripts/build-index.mjs          # rebuild dist/index.json + dist/catalog.json
```

`dist/` is generated — changes land through the `index-publish` workflow's
auto-merged PR, never by hand.

## 🛠️ Plugin development

Each plugin under `plugins/` is an independently installable package:

```sh
cd plugins/loop
pnpm install
pnpm test
pnpm build
```

The source tree intentionally stays outside the DeepSeek Harness repository;
dsh composes plugins through profile-scoped installation and patch layers.
See [AGENTS.md](./AGENTS.md) for the agent working rules and
[docs/](./docs/) for architecture notes and how-to guides.

## 📚 Documentation

- [Marketplace & manifest spec](./docs/market.md)
- [Plugin docs](./plugins/) — each plugin directory has its own README
- [Architecture & how-to guides](./docs/)
- [Mayfly](https://github.com/Ephemeral-AI-Lab/mayfly) · [Mayfly website](https://may-fly.dev)

## 🤝 Contributing

Issues, ideas, and pull requests are welcome. Keep plugins focused, document
their runtime contracts, and include tests for changes to tools, persistence,
or UI behavior.

## 📄 License

Released under the [MIT License](./LICENSE).
