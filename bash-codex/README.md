# bash-codex

`bash-codex` is a standalone DeepSeek Harness plugin that provides the
Codex-compatible `exec_command` and `write_stdin` tools.

The plugin starts a fresh shell process for every `exec_command` call and keeps
that process available for later `write_stdin` calls while it is running. PTY
transport is the default. If PTY allocation fails, the configured `ptyFallback`
policy can use an explicit-argv pipe backend or fail the call.

## Build and load

```powershell
pnpm install
pnpm build
```

Load the compiled absolute module path from a DHS Cordis patch:

```yaml
- insert:
    - id: bash-codex
      name: 'C:\path\to\dsh-plugins\bash-codex\lib\index.js'
```

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
