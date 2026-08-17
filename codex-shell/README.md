# dsh-codex-shell 🐋

Adds Codex-style `exec_command` and `write_stdin` tools to DeepSeek
Harness.

## Current release: 0.1.2

This release makes pipe transport the default on Windows, macOS, and Linux.
Completed sessions retain unread output for subsequent `write_stdin` polls,
including token-capped pagination and natural-exit notifications. The release
also includes eight reusable E2E prompts covering basic commands, nonzero
exits, stdin, delayed output, natural exits, pagination, interactive sessions,
and concurrent-session cleanup.

The package was verified with the full unit suite and build. See the [E2E test
prompts](e2e-test-prompt.md) and [0.1.2 changelog](changelog/0.1.2.md).

## 🚀 1. Install the plugin

Install it into the DSH profile you use:

```powershell
dsh plugin --profile web add dsh-codex-shell@0.1.2
```

From a DeepSeek Harness source checkout:

```powershell
cd C:/path/to/deepseek-harness
pnpm install
pnpm dsh plugin --profile web add dsh-codex-shell@0.1.2
```

> ⚠️ Do not run `npm install dsh-codex-shell` as a separate setup step. The
> DSH plugin command installs it into the selected profile. `pnpm install` in
> the source checkout only bootstraps DSH itself.

## 🐋 2. Create the Codex Whale preset

In the DSH web UI, open **Settings -> Agent presets** and choose **Draft a
custom preset with Creator mode**.

Paste this prompt:

```text
Create a user preset named "Codex Whale" with ID `codex-whale`.

Duplicate the Standard preset and configure it as follows:

- Add exactly one row:
  - id: codex-shell
    name: dsh-codex-shell
- Disable `tool-bash`, `tool-pwsh`, and `tool-jobs`.
- Disable any other persistent or alternate terminal tools.
- Keep all non-shell coding tools.
- Do not modify shipped presets.
- Do not add duplicate `codex-shell` rows.

Validate the result before finishing.
```

### 💡 Important

- Installing the npm plugin enables it in the **DSH profile**.
- Adding the `codex-shell` row enables its tools in the **agent preset**.
- The preset disables the native shell tools.

## 🧰 Tools

### `exec_command`

`exec_command(cmd: string, workdir?: string, yield_time_ms?: number, max_output_tokens?: number)` - Runs one command in the host shell. Short commands return output; long-running commands return a `session_id` for `write_stdin`.

- `cmd` (`string`, required) - Command to run.
- `workdir` (`string`, optional) - Working directory for the command.
- `yield_time_ms` (`number`, optional) - Wait time before returning; default `10000` ms.
- `max_output_tokens` (`number`, optional) - Maximum output token budget; default configured limit (`10000` by default).

### `write_stdin`

`write_stdin(session_id: number, chars?: string, yield_time_ms?: number, max_output_tokens?: number)` - Writes input to an existing session or polls for more output.

- `session_id` (`number`, required) - Positive session ID returned by `exec_command`.
- `chars` (`string`, optional) - Characters to send; omit or use an empty string to poll.
- `yield_time_ms` (`number`, optional) - Wait time for output; default `250` ms.
- `max_output_tokens` (`number`, optional) - Maximum output token budget; default configured limit (`10000` by default).

Typical flow: call `exec_command`; if it returns a `session_id`, call
`write_stdin` with that ID to send input or poll until the terminal result is
fully collected. A terminal result may contain both `exit_code` and
`session_id` when `max_output_tokens` capped the current page; keep polling
with empty `chars` until `session_id` is no longer returned.

## 🧭 Current session behavior

- Pipe transport is the default on Windows, macOS, and Linux. A real PTY is
  not required for the `exec_command` plus `write_stdin` lifecycle.
- Output produced after `exec_command` returns is retained for the next
  `write_stdin` poll.
- An exited process remains pollable while unread output is buffered. The
  session is released only after its terminal output has been collected.
- `max_output_tokens` limits each response page; it does not discard buffered
  output. Continue polling to retrieve later pages.
- Natural-exit notifications identify the session and instruct the owner to
  call `write_stdin` with empty `chars`.
- Session output and process resources are bounded and cleaned up on terminal
  completion, owner disposal, and plugin disposal.

## 🎯 Why do we need it?

Most Bash or Shell tools use a one-shot model: run a command, read its output,
and return. That works for `ls`, `git status`, builds, and ordinary tests, but
not for a CLI that waits for input while it is still running.

For example, an interactive `rng` program requires the agent to:

1. Start the process.
2. Read the generated number.
3. Send the answer to the same process.
4. Read `PASS` or `FAIL`.
5. Confirm the final exit code.

The same pattern is needed for device-code login, OAuth flows, REPLs, SSH
sessions, database prompts, and end-to-end CLI tests. Background execution
alone is not enough if the agent cannot write to the original process.

See the full motivation in [Why Claude Code, Pi, and DSH cannot complete
interactive CLIs](https://x.com/yifanxu_ephai/status/2088905874232459741).

## ⭐ Why Codex-style tools?

The two-tool design is a good fit for coding agents because it connects the
complete interactive flow:

- **Start** - `exec_command` launches the process and returns early when it is
  still running.
- **Continue** - `write_stdin` sends input to that same session.
- **Observe** - `write_stdin` can poll for more output without sending input.
- **Verify** - the agent can wait for the final output and exit code.
- **Reuse** - the same small interface works across Windows, macOS, and Linux.

## ✅ 3. Select and restart

1. Set **Codex Whale** as the default preset.
2. Restart DSH.
3. Create a new session.

Existing sessions keep their old tools.

## 🔍 4. Verify

Check the profile:

```powershell
dsh --profile web --dump-config
```

It should contain exactly one:

```text
- id: codex-shell
  name: dsh-codex-shell
```

In a new Codex Whale session, confirm that:

- ✅ `exec_command` is available
- ✅ `write_stdin` is available
- 🚫 native Bash/PowerShell tools are unavailable

## 🛠️ Troubleshooting

### `dsh` is not found

Run the command from a DeepSeek Harness checkout with `pnpm dsh`, or install
the published DSH CLI.

### `node-pty` build is blocked

Add this to the target profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  node-pty: true
```

Then install the plugin again.

### The profile has an older plugin version

```powershell
dsh plugin --profile web remove dsh-codex-shell
dsh plugin --profile web add dsh-codex-shell@0.1.2
```

## 📚 Documentation

- [Implementation specification](SPEC.md)
- [Reusable E2E test prompts](e2e-test-prompt.md)
- [0.1.0 changelog](changelog/0.1.0.md)
- [0.1.1 changelog](changelog/0.1.1.md)
- [0.1.2 changelog](changelog/0.1.2.md)
