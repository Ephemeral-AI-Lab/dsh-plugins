# dsh-codex-shell

`dsh-codex-shell` is a DeepSeek Harness npm bundle that provides the
Codex-compatible `exec_command` and `write_stdin` tools.

The plugin starts a fresh shell process for every `exec_command` call and keeps
that process available for later `write_stdin` calls while it is running. PTY
transport is the default. If PTY allocation fails, the configured `ptyFallback`
policy can use an explicit-argv pipe backend or fail the call.

## Install and load

DSH plugins are installed into one named profile at a time. Always include
`--profile`; there is no profile-less global install command.

From the published DSH CLI, install it into the web profile:

```bash
npx -y @deepseek-ai/dsh plugin --profile web add dsh-codex-shell
```

If `dsh` is already available as a command, the shorter form is:

```bash
dsh plugin --profile web add dsh-codex-shell
```

The package contains a DSH bundle patch that registers this plugin as
`codex-shell`. The current Web bundle supplies the agent-preset roster and
selects `codex-whale`; restart the profile after installation.

For a local checkout:

```yaml
- insert:
    - id: codex-shell
      name: '/absolute/path/to/dsh-plugins/codex-shell/lib/index.js'
```

The npm bundle follows the same `dsh.bundle.patch` pattern used by the
[dsh-web-ui plugin](https://github.com/zhu1090093659/dsh-web-ui): the package
ships a `cordis.patch.yml` and declares it in `package.json`.

### Source checkout

From a DSH source checkout:

```bash
cd /path/to/deepseek-harness
pnpm install
pnpm dsh plugin --profile web add dsh-codex-shell
```

On macOS, a source checkout does not automatically create a global `dsh`
executable. To use `dsh ...` directly, add this wrapper to `~/.zshrc` and
replace the path with your checkout path:

```zsh
dsh() {
  (
    cd /path/to/deepseek-harness &&
      pnpm dsh "$@"
  )
}
```

Then reload the shell with `source ~/.zshrc`.

### Profile scope

Installing the plugin into `web` does not change `tui`, `headless`, or any
other profile. Install it once for each profile that should use the exclusive
Codex shell. For example, in zsh:

```zsh
for dir in /path/to/.dsh/profiles/*(/); do
  dsh plugin --profile "${dir:t}" add dsh-codex-shell
done
```

### Verify the installation

Dump the composed profile configuration:

```bash
dsh --profile web --dump-config
```

The output should show `codex-shell` enabled and `codex-whale` selected as the
default agent preset when the preset is available in the DSH application.

## DSH Plugin Market

DSH also has a community plugin market. Install it into the profile you want
to use:

```bash
dsh plugin --profile web add dshmarket
```

Restart DSH, then open **Settings → Plugin Market** in the web UI. The market
is a third-party DSH plugin and uses the curated
[`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
registry. Publishing this package to npm does not automatically list it in the
market; listing requires submitting an entry to that registry.

## Codex Whale preset

The DSH checkout in this repository includes the `Codex Whale` preset with ID
`codex-whale`. It is the recommended preset for this plugin and exposes the
Codex shell exclusively. The preset must be shipped by the DSH application
under `apps/cli/config/agent-presets/codex-whale`; the current stock CLI does
not discover preset directories from an npm bundle.

The preset is intentionally separate from the legacy `standard`, `code`, and
`minimal` presets so installing this bundle does not silently break existing
profiles. Selecting one of those legacy presets can still expose its original
shell tools.

## macOS and Linux

On POSIX hosts, commands run through the resolved POSIX shell (`$SHELL`, then
`/bin/sh`). On Windows, the adapter uses PowerShell. `exec_command` starts a
fresh shell process; a running process returns an opaque session ID for
`write_stdin`.

The model-visible schemas intentionally contain only `cmd`, `workdir`,
`yield_time_ms`, `max_output_tokens`, `session_id`, and `chars`. Shell choice,
PTY selection, execution policy, and process cleanup are deployment-level
configuration.

When `exec_command` leaves a process running, its rendered text includes a
`[session_id: N]` marker so the model can pass that ID to `write_stdin`.

PTY output is also normalized for model visibility: ANSI/VT control sequences
such as Windows ConPTY startup and terminal-title codes are removed while
printable text, line endings, Unicode, and interactive input remain intact.

On Windows, `windowsPtyStartupGraceMs` controls the startup grace before the
first PTY input; it defaults to `2000` and may be set to `0` when the host does
not need the PowerShell/ConPTY startup guard. This is deployment configuration,
not part of either model-visible tool schema.

The default configuration is trusted execution with a pipe fallback.
`executionMode: host-policy` is intentionally fail-closed and currently
unsupported until this plugin is given an explicit DHS policy adapter; it does
not silently grant host access or claim to provide confinement.

## Troubleshooting

### `zsh: command not found: dsh`

The DSH CLI is not on `PATH`. Use the source-checkout form above or run the
published CLI through `npx`.

### `ERR_PNPM_IGNORED_BUILDS`

The `node-pty` dependency may require explicit pnpm build approval. Run
`pnpm approve-builds --all` in the target profile directory, then repeat the
plugin installation.

### The plugin is installed but legacy shell tools remain

Check the profile that was modified:

```bash
dsh --profile web --dump-config
```

The bundle patch is applied per profile. Install the plugin into every profile
that should use the exclusive Codex shell.
