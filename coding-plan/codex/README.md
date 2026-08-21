# dsh-codex-coding-plan

This is an implementation dependency of the published
[`dsh-coding-plan`](https://www.npmjs.com/package/dsh-coding-plan) bundle. Most
users should install the root bundle instead of this package directly.

Use an existing file-backed Codex CLI ChatGPT login as the `openai-codex`
provider in DeepSeek Harness. The bundle configures the existing
`@deepseek-ai/dsh-llm-pi-ai` plugin, so the provider appears on the Models page
and in model selectors without another LLM adapter.

## Install

```sh
dsh plugin --profile web add dsh-coding-plan
```

Sign in through Codex first:

```sh
codex login
codex login status
```

Codex must use file-backed credential storage. In `$CODEX_HOME/config.toml`
(default `~/.codex/config.toml`):

```toml
cli_auth_credentials_store = "file"
```

The plugin reads `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) on the
Host only, refreshes an expiring ChatGPT token through pi-ai, and synchronizes
only the current access token into the existing DSH credential service. No
token is sent to the browser or written to plugin configuration. The temporary
DSH credential is removed on clean shutdown.

## Limitations

- OS-keyring Codex credentials are not imported; use Codex's `file` storage.
- The existing Models editor still describes credentials as API keys. This
  plugin makes Codex Coding Plan appear and work there, but a dedicated
  “Use existing Codex login” card requires an upstream provider-auth UI slot.
- Codex's cached-auth file is not a documented third-party API. A future Codex
  format change may require updating the parser.
