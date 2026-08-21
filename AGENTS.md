# DSH Plugins Agent Guide

You are working on `dsh-plugins`, a repository for developing plugins for
DeepSeek Harness (DSH).

Your job is to develop, test, document, and maintain DSH plugins in this
repository. These plugins extend DeepSeek Harness through Cordis composition,
profile bundle patches, model-visible tools, runtime services, and optional
Web client modules.

This is plugin development, not DeepSeek Harness host development. The
DeepSeek Harness checkout at:

`/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness`

is read-only reference and runtime infrastructure. Do not modify it unless the
user explicitly authorizes a host-repository change.

## Repository boundary

All implementation changes belong under:

`/Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins`

Do not edit, format, build, install dependencies, clean, reset, or commit in
`deepseek-harness` by default. Running its existing `pnpm dsh web` command to
launch the Web host is allowed. If host artifacts are missing or stale, stop
and ask before rebuilding the host.

Do not create a nested `deepseek-harness-docs` repository or directory. Keep
plugin documentation under this repository's `docs/` directory.

Before and after a task, inspect both working trees without changing them:

```sh
git -C /Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins status --short
git -C /Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness status --short
```

Preserve pre-existing user changes. Never reset, clean, or revert unrelated
work.

## Read before starting

Read these files in order:

1. [`README.md`](README.md) for the package inventory and installation examples.
2. [`docs/project.md`](docs/project.md) for DSH architecture, Cordis composition,
   Host versus agent planes, and session lifecycle.
3. [`docs/ephemeral_ai_harness_preset.md`](docs/ephemeral_ai_harness_preset.md)
   for the Web profile loading, restart, and validation contract.
4. [`docs/tools.md`](docs/tools.md) when changing model-visible tools or tool
   composition.
5. The target plugin's own `README.md`, `package.json`, `cordis.patch.yml`,
   `src/index.ts`, tests, and `SPEC.md` or other implementation notes.

Use the host repository only as read-only reference when the task requires
host behavior details:

- `deepseek-harness/README.md`
- `deepseek-harness/apps/cli/README.md`
- `deepseek-harness/apps/cli/reference/README.md`
- `deepseek-harness/docs/user/develop/basic/publish.md`
- `deepseek-harness/docs/subsystems/client-modules.md` for client HMR behavior

The architecture guide records a historical DSH baseline. Confirm current
host behavior from the checked-out source before relying on version-sensitive
details.

## Repository map

```text
dsh-plugins/
├── codex-terminal/       Persistent exec_command/write_stdin tools
├── coding-plan/          Codex and Grok subscription providers
├── loop/                 Recurring prompts and loop UI
├── mock/                 Deterministic model/replay testing
├── preset-builder/       Preset configuration UI
├── sessions/             Session discovery and messaging
└── docs/                 Architecture, tool references, and how-to guides
```

Each plugin is an independently buildable package. Its `cordis.patch.yml` is
part of the runtime contract. Treat `package.json`, the patch, source, tests,
and generated `lib/` output as one package workflow.

## Local plugin workflow

Use absolute paths when installing a checkout into a DSH profile:

```sh
PLUGIN=/Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/<plugin>
HOST=/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness

cd "$PLUGIN"
pnpm install       # only inside dsh-plugins, when dependencies are missing
pnpm test
pnpm build

cd "$HOST"
pnpm dsh plugin --profile web add "$PLUGIN"
pnpm dsh --profile web --dump-config
```

An installed `dsh` CLI may be used instead of `pnpm dsh`. Re-run the profile
install command when the package manifest, bundle patch, or local installation
path changes.

Run the smallest relevant package checks first. Prefer the target package's
existing `test`, `typecheck`, `build`, or `build:client` scripts; do not invent
new test harnesses for a one-line change.

## Launch the DSH Web host

From the existing host checkout, launch Web with:

```sh
cd /Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness
pnpm dsh web
```

`dsh web` is the alias for `dsh --profile web`. It uses the host's existing
built artifacts and prints the loopback URL. Do not automatically run
`pnpm run build`, `pnpm run dev:web`, or `pnpm install` in the host checkout:
those commands can write host artifacts or dependencies. Ask the user first if
the host must be rebuilt.

## Reload behavior

Use this matrix when deciding how to verify a change:

| Change | Action |
|---|---|
| Plugin server or TypeScript code | Build the plugin, then restart `pnpm dsh web`. |
| Plugin client code | Run the plugin's client/full build, restart Web, and refresh the browser. |
| `cordis.patch.yml` or profile YAML | Save and allow the profile patch watcher to reload; restart if stale. |
| `package.json` or installation path | Re-run `dsh plugin --profile web add <absolute-path>`, then restart. |
| Tool composition or preset | Restart as needed and create a new session. |
| Existing session after composition changes | Start a new session; existing sessions keep their old tool composition. |

The shipped Web bundle does not provide ordinary module HMR for plugin code.
The safe default loop for source changes is:

```sh
cd /Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/<plugin>
pnpm build

cd /Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness
pnpm dsh web
```

The host's client-development watcher can provide HMR, but it requires
`pnpm run dev:web` in `deepseek-harness`. That is an explicit exception to the
read-only host rule, not the default workflow.

## Verification and handoff

Before finishing:

- Run the target plugin's relevant tests, typecheck, and build commands.
- Verify the effective Web profile with `pnpm dsh --profile web --dump-config`.
- Start a new Web session when tool composition changes.
- Confirm no host-repository files were modified.
- Keep generated files only where the plugin's existing workflow expects them.
- Report the plugin changed, commands run, reload/restart action, and any
  unresolved host-artifact or environment dependency.

