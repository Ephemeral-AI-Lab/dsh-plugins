# 🧩 DSH Harness Plugins

<p align="center">
  <img src="./assets/dsh-plugins-icon.png" alt="DSH Plugins icon" width="220">
</p>

<p align="center">
  Small, focused plugins that make <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> more capable, expressive, and pleasant to use.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/dsh-codex-shell"><img src="https://img.shields.io/npm/v/dsh-codex-shell?logo=npm&logoColor=white&style=flat-square" alt="dsh-codex-shell on npm"></a>
  <a href="https://www.npmjs.com/package/dsh-loop"><img src="https://img.shields.io/npm/v/dsh-loop?logo=npm&logoColor=white&style=flat-square" alt="dsh-loop on npm"></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-packages">Packages</a> ·
  <a href="#-development">Development</a> ·
  <a href="#-documentation">Documentation</a>
</p>

> 🧠 Give your DSH sessions better tools, durable workflows, and a cleaner path from idea to execution.

## ⚡ Quick start

Published plugins install directly into a DSH profile with one command. The
examples below target the `web` profile; replace `web` with the profile you use.

### 🐚 Codex Shell

```powershell
dsh plugin --profile web add dsh-codex-shell@0.1.2
```

### ⏰ Loop

```powershell
dsh plugin --profile web add dsh-loop@0.1.0
```

Restart DSH and create a new session after installing a plugin. If `dsh` is not
on your PATH, run the same command from a DeepSeek Harness source checkout with
`pnpm dsh` instead.

## 📦 Packages

| Package | Status | What it adds | Docs |
| --- | --- | --- | --- |
| [`dsh-codex-shell`](./codex-shell/) | ✅ Published · `0.1.2` | Codex-compatible `exec_command` and `write_stdin` tools with persistent command sessions. | [`README`](./codex-shell/README.md) · [npm](https://www.npmjs.com/package/dsh-codex-shell) |
| [`dsh-loop`](./loop/) | ✅ Published · `0.1.0` | Session-scoped recurring alarms, loop tools, slash commands, and a web UI. | [`README`](./loop/README.md) · [npm](https://www.npmjs.com/package/dsh-loop) |
| [`codex-session-communication`](./codex-session-communication/) | 🛠️ Source-only | Cross-session tools for creating, messaging, waiting on, and inspecting DSH sessions. | [`SPEC`](./codex-session-communication/SPEC.md) |

### 🐚 `dsh-codex-shell`

Run shell commands like a Codex-style agent: start long-running processes,
poll for output, and send input to persistent sessions. PTY transport is used
by default with a configured pipe fallback when PTY allocation is unavailable.

### ⏰ `dsh-loop`

Create durable, session-local recurring prompts that can be managed through
agent tools, `/loop` commands, and the web UI. Loops resume with the session
and keep each alarm independent from the others.

### 🔗 `codex-session-communication`

Coordinate multiple DSH sessions from one agent: delegate work, send messages,
wait for progress, inspect transcripts, and list visible sessions. This package
is still experimental and is not published to npm yet.

## 🛠️ Development

Each plugin is independently installable and testable. For example:

```powershell
cd loop
pnpm install
pnpm test
pnpm build
```

The source tree intentionally stays outside the DeepSeek Harness repository;
DSH composes plugins through profile-scoped installation and patch layers.

## 📚 Documentation

- [Codex Shell documentation](./codex-shell/README.md)
- [Loop documentation](./loop/README.md)
- [Session communication specification](./codex-session-communication/SPEC.md)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## 🤝 Contributing

Issues, ideas, and pull requests are welcome. Keep plugins focused, document
their runtime contracts, and include tests for changes to tools, persistence,
or UI behavior.

## 📄 License

Released under the [MIT License](./LICENSE).
