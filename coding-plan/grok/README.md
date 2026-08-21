# dsh-grok-coding-plan

This is an implementation dependency of the published
[`dsh-coding-plan`](https://www.npmjs.com/package/dsh-coding-plan) bundle. Most
users should install the root bundle instead of this package directly.

Use the existing file-backed Grok subscription login from DeepSeek Harness.
The bundle reuses pi-ai's catalog `xai` provider, so DSH exposes its installed
Grok models without adding another LLM wire adapter.

## Install

```sh
dsh plugin --profile web add dsh-coding-plan
```

Sign in through Grok first:

```sh
grok login
```

The plugin reads `$GROK_HOME/auth.json`, defaulting to `~/.grok/auth.json`.
It refreshes an expiring xAI OAuth token through pi-ai and synchronizes only
the current access token into DSH's credential service. The token is not sent
to the browser or written to plugin configuration, and the temporary DSH
credential is removed on clean shutdown.

## Models

The installed xAI catalog supplies:

- `grok-4.3`
- `grok-4.5`
- `grok-build-0.1`

`grok-4.6` is exposed through the explicit `xai-grok-4-6` route because the
DSH host keeps its stable pi-ai catalog version. It uses the same Grok
credential and the existing OpenAI-compatible completions adapter.

The plugin does not override the active DSH model. Select one through the
Models page or set the DSH default explicitly:

```yaml
agent-default-model:
  provider: xai-grok-4-6
  model: grok-4.6
```
