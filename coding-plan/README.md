# DSH Coding Plan

One installable DSH bundle for local Codex and Grok coding-plan logins. The
published package is [`dsh-coding-plan`](https://www.npmjs.com/package/dsh-coding-plan);
the Codex, Grok, and shared OAuth code is bundled inside that one package.

```text
core  -> shared file-backed OAuth cache, refresh, and atomic persistence
codex        -> ~/.codex/auth.json -> openai-codex -> Codex models
grok         -> ~/.grok/auth.json  -> xai          -> Grok 4.3/4.5/build
grok-4.6     -> ~/.grok/auth.json  -> xai-grok-4-6 -> Grok 4.6
models.json  -> machine-readable model and thinking-effort offering table
```

## Install from npm

```sh
dsh plugin --profile web add dsh-coding-plan
```

Restart the DSH profile after installing or updating the bundle. The package
owns one complete `llm-pi-ai` configuration row and mounts both auth
synchronizers, so users should install the root package rather than the
implementation packages separately.

## Login and model selection

Sign in through the native CLIs first:

```sh
codex login
grok login
```

The adapters read `~/.codex/auth.json` and `~/.grok/auth.json`, refresh tokens
through the shared pi-ai runtime, and synchronize only short-lived access
tokens into DSH's credential service.

Select the provider and model from the model picker inside a DSH session. The
Settings → Models page manages provider credentials and routes; it is not the
active conversation model picker.

The current stable Grok 4.6 route is explicit:

```yaml
agent-default-model:
  provider: xai-grok-4-6
  model: grok-4.6
```

The route uses the shared DSH `llm-pi-ai` runtime and does not introduce a
second request engine. Grok 4.6 is exposed through `xai-grok-4-6` because the
stable DSH pi-ai catalog does not natively list that model yet.

## Model table

[`models.json`](./models.json) records the offered routes, model IDs, API
families, and exact thinking-effort IDs. It is packaged as a reference
manifest; the current runtime configuration is the bundle's
[`cordis.patch.yml`](./cordis.patch.yml).

See [`SPEC.md`](./SPEC.md) for the dependency policy, migration boundary, and
the optional future merge of Grok 4.6 into the native `xai` group.
