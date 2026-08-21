---
title: DSH Coding Plan Provider Workspace
date: 2026-08-21
tags:
  - dsh
  - coding-plan
  - pi-ai
  - architecture
status: proposed
---

# DSH Coding Plan Provider Workspace

## 1. Summary

Create one `coding-plan` workspace that hosts all subscription-backed DSH
model providers. Codex and Grok remain separate authentication adapters, but
share one core package, one workspace lockfile, and one pinned
`@earendil-works/pi-ai` version.

The DSH host LLM adapter must use that same pi-ai version. The stable design
does not require DSH to upgrade its pi-ai catalog: Grok 4.6 can use an
explicit `xai-grok-4-6` route while still using the same DSH `llm-pi-ai`
runtime and the same xAI credential. If DSH later upgrades safely and its
native catalog contains Grok 4.6, the explicit route may be collapsed into
`xai`, but that is an optimization rather than a correctness requirement.

The target is one DSH provider composition:

```text
DSH Models
├── Codex Coding Plan / openai-codex
│   └── Codex catalog models
└── Grok Coding Plan
    ├── xai → grok-4.3, grok-4.5, grok-build-0.1
    └── xai-grok-4-6 → grok-4.6 (explicit route, same pi-ai runtime)
```

This is a DSH provider workspace. It is not a Grok CLI plugin and does not
delegate work from Grok to Codex.

## 2. Goals

- Keep every coding-plan provider under one repository workspace.
- Use one `pnpm-lock.yaml` and one resolved pi-ai version for coding-plan
  packages.
- Align the DSH host's `llm-pi-ai` dependency to that same pi-ai version.
- Share file-backed OAuth cache handling in `coding-plan/core`.
- Keep Codex and Grok auth formats isolated behind thin provider adapters.
- Let pi-ai own provider model catalogs, API protocols, model capabilities, and
  provider-specific request behavior.
- Keep model offering metadata in the JSON manifest without requiring the DSH
  host catalog to know every newly released model.
- Expose Codex and Grok through the existing DSH Models page and model
  selection seams.
- Preserve the current default model unless the user explicitly changes it.
- Make provider refresh, credential cleanup, and plugin disposal deterministic.

## 3. Non-goals

- No Grok-to-Codex delegation plugin.
- No custom HTTP proxy between DSH and xAI or ChatGPT.
- No second model protocol implementation in the coding-plan packages.
- No copying access tokens into `settings.yaml`, plugin configuration, or the
  browser.
- No automatic switch of `agent-default-model` when a provider is installed.
- No hardcoded duplicate provider implementation in the coding-plan packages;
  the JSON manifest is an explicit offering table, not a second stream engine.
- No independent pi-ai dependency per provider package.

## 4. Current state

The current local implementation has three packages under
[`coding-plan/`](./):

```text
coding-plan/
├── core/
├── codex/
└── grok/
```

The Codex and Grok bundles are installed in the local DSH Web profile. The
Grok 4.6 route currently uses an explicit provider route:

```text
xai-grok-4-6 → grok-4.6
```

That route exists because the DSH host is pinned to a pi-ai catalog that does
not contain Grok 4.6. It is not a second pi-ai runtime and does not bypass
`llm-pi-ai`; it supplies the model-specific provider metadata that the stable
host catalog lacks. The latest pi-ai catalog contains the model, but upgrading
the host adapter changes upstream compatibility fields and stream semantics
that the current DSH adapter tests intentionally lock down. The explicit route
is therefore allowed to remain permanently if DSH never upgrades.

The current bundle patches also target the same `llm-pi-ai` row. DSH patch
application replaces the row's complete `config`; it does not deep-merge
provider keys. Therefore every patch that owns that row must either carry the
complete coding-plan provider config or, preferably, the combined bundle must
be the sole owner of that row.

## 5. Target layout

```text
dsh-plugins/coding-plan/
├── package.json                 # private workspace root and combined DSH bundle
├── pnpm-workspace.yaml
├── pnpm-lock.yaml               # single lockfile for all coding-plan packages
├── README.md
├── SPEC.md
├── models.json                  # machine-readable model/effort offering table
├── core/
│   ├── package.json
│   └── src/
│       └── index.ts             # generic OAuth file lifecycle
├── codex/
│   ├── package.json
│   └── src/
│       ├── auth.ts              # Codex auth.json parser
│       └── index.ts             # DSH credential synchronizer
└── grok/
    ├── package.json
    └── src/
        ├── auth.ts              # Grok auth.json parser
        └── index.ts             # DSH credential synchronizer
```

### 5.1 Workspace root

The root package is the installable DSH bundle. It owns the combined
`llm-pi-ai` patch and mounts the Codex and Grok synchronizers. The root package
is the only package that declares a DSH bundle patch.

```json
{
  "name": "dsh-coding-plan",
  "private": true,
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

The profile installs one package:

```sh
dsh plugin --profile web add ./coding-plan
```

The root package depends on the `codex` and `grok` packages as ordinary local
source packages during development. The publishable root package embeds their
compiled runtimes under `dsh-coding-plan/codex` and `dsh-coding-plan/grok`.
Those child directories are private implementation sources; they are not
separate npm packages and users install only `dsh-coding-plan`.

### 5.2 Core package

`core` owns only provider-neutral file-backed OAuth behavior:

- bounded file reads;
- JSON cache loading delegated to an adapter parser;
- expiry checks with refresh skew;
- cross-process file locking;
- atomic cache persistence;
- refreshed credential validation;
- preservation of unrelated auth-cache fields.

`core` must not know whether a cache belongs to Codex or Grok. It receives a
parser, an updater, and a provider refresh callback.

### 5.3 Codex adapter

The Codex adapter reads:

```text
$CODEX_HOME/auth.json
```

or, when `CODEX_HOME` is unset:

```text
~/.codex/auth.json
```

It uses pi-ai's OpenAI Codex OAuth implementation to refresh the token and
stores only the current access token in DSH under:

```text
CODEX_CODING_PLAN_ACCESS_TOKEN
```

The adapter does not own the `llm-pi-ai` provider configuration. The combined
root bundle owns that configuration.

### 5.4 Grok adapter

The Grok adapter reads:

```text
$GROK_HOME/auth.json
```

or, when `GROK_HOME` is unset:

```text
~/.grok/auth.json
```

It selects the xAI OAuth entry, refreshes through pi-ai's xAI OAuth
implementation, and stores only the current access token in DSH under:

```text
GROK_CODING_PLAN_ACCESS_TOKEN
```

The adapter does not implement Grok streaming. The installed pi-ai runtime is
authoritative for request behavior; `models.json` declares the DSH offering
surface, including explicit routes for models absent from the host catalog.

### 5.5 JSON model and thinking-effort manifest

[`models.json`](./models.json) is the machine-readable offering table. Each
row identifies the DSH provider route, model ID, API family, and the exact
thinking-effort IDs exposed to the UI. The manifest also records whether a
route is native-catalog or explicit.

The JSON file is the source of truth for the coding-plan offering surface. A
Markdown table, if needed for documentation, is a generated projection and
must not be maintained separately.

`catalogAuthority` deliberately remains `pi-ai`: the manifest declares what
this DSH bundle offers, while pi-ai remains authoritative for provider
implementation, request serialization, and native model metadata. This avoids
creating a second protocol/catalog implementation in the plugin.

The current deployable manifest uses `xai-grok-4-6` as an explicit route. That
route is part of this design's stable fallback, not an unstable dependency
fork. Native placement under `xai` is optional and can happen only after a
DSH host upgrade passes its compatibility and smoke-request gates.

### 5.6 Dynamic DSH loading

The combined root DSH plugin must load `models.json` at activation time and
validate it before building the combined `llm-pi-ai` configuration:

```text
models.json
    │ JSON.parse + schema validation
    ▼
coding-plan catalog service
    │ provider routes, display names, credential envs, model rows
    ▼
combined llm-pi-ai config + Models-page metadata
```

The loader must:

- read the packaged file relative to the root bundle, not from the current
  working directory;
- reject malformed JSON, duplicate provider/model rows, unknown providers, and
  empty thinking-effort lists before publishing configuration;
- use the manifest for the advertised offering and capability table without
  implementing a second provider stream;
- keep credentials out of the JSON file;
- reload the manifest when DSH is reloaded, so editing the file and reloading
  DSH updates the model surface without editing YAML or TypeScript;
- fail closed on invalid content and retain/log the last valid catalog when a
  live reload mechanism is later added.

The first implementation should use activation-time loading plus DSH reload.
A file watcher is unnecessary until a real requirement exists for changing
model offerings without reloading DSH.

## 6. Dependency policy

### 6.1 One workspace version

The `coding-plan` workspace declares one pi-ai version. `core`, `codex`, and
`grok` use that workspace resolution rather than independent package locks.

The DSH host package
`deepseek-harness/packages/llm/llm-pi-ai/package.json` must declare the same
version. This is the important part: a coding-plan-local pi-ai version alone
would still leave the DSH host with a second runtime catalog.

The dependency invariant is:

```text
coding-plan/core       ┐
coding-plan/codex      ├── @earendil-works/pi-ai = one pinned version
coding-plan/grok       ┘
DSH llm-pi-ai          ─── same pinned version
```

CI or a local verification script should fail when the workspace and host
resolve different pi-ai versions.

### 6.2 Runtime ownership

The DSH host's `llm-pi-ai` adapter remains the request owner. Coding-plan
packages do not call provider streams directly for agent turns. They provide
authentication synchronization and bundle composition; the host adapter
resolves models and dispatches requests.

This keeps one request path, one retry/timeout policy, one replay path, and one
model capability interpretation for every provider.

## 7. Combined DSH composition

The root bundle owns one complete `llm-pi-ai` configuration row:

```yaml
- id: llm-pi-ai
  config:
    providers:
      openai-codex:
        displayName: Codex Coding Plan
        apiKeyEnv: CODEX_CODING_PLAN_ACCESS_TOKEN
      xai:
        displayName: Grok Coding Plan
        apiKeyEnv: GROK_CODING_PLAN_ACCESS_TOKEN

- insert:
    - id: codex-coding-plan
      name: dsh-codex-coding-plan
    - id: grok-coding-plan
      name: dsh-grok-coding-plan
```

The provider and model rows in this configuration are generated from
`models.json` by the root bundle loader. The YAML patch remains only the DSH
composition seam; provider/model tables must not be duplicated there. The
loader must support both native `xai` rows and the explicit
`xai-grok-4-6` row.

The Codex and Grok child packages must not independently patch `llm-pi-ai`.
This prevents one provider's bundle from removing the other provider's route.

If the host pi-ai catalog never contains Grok 4.6, the explicit
`xai-grok-4-6` route remains the supported production configuration. If the
host later gains native support, removing the explicit route is optional and
must not be required for the rest of coding-plan to work.

## 8. Model and authentication flow

```text
DSH starts
   │
   ├── root coding-plan bundle loads combined llm-pi-ai config
   ├── Codex synchronizer reads ~/.codex/auth.json
   ├── Grok synchronizer reads ~/.grok/auth.json
   ├── DSH credential service stores current access tokens
   └── llm-pi-ai resolves model catalog and provider auth per request

Agent selects openai-codex/gpt-5.x
   └── DSH resolves CODEX_CODING_PLAN_ACCESS_TOKEN

Agent selects xai/grok-4.6
   └── DSH resolves GROK_CODING_PLAN_ACCESS_TOKEN
```

The browser receives provider/model metadata and credential status only. Access
token values remain Host-side.

## 9. Migration plan

### Phase 1: Consolidate the workspace

- Add the `coding-plan` root package and workspace file.
- Move to one root lockfile.
- Keep `core`, `codex`, and `grok` as child packages.
- Make child packages peer-depend on the workspace pi-ai version where
  practical.
- Preserve the current local auth tests.

### Phase 2: Create the combined bundle

- Move the complete `llm-pi-ai` provider config to the root bundle patch.
- Remove `dsh.bundle.patch` declarations from the child adapter packages.
- Insert both child synchronizer plugins from the root patch.
- Install only `./coding-plan` in the DSH profile.
- Remove the duplicated per-provider `llm-pi-ai` patches.

### Phase 3: Keep the DSH host stable

- Keep `@deepseek-ai/dsh-llm-pi-ai` on the proven pi-ai version unless a
  coordinated upgrade is justified.
- Keep the coding-plan packages on that same version.
- Treat any newer pi-ai version as an optional host migration, not a
  prerequisite for Grok 4.6.
- If an upgrade is attempted, preserve DSH behavior for request serialization,
  aborts, retries, replay, reasoning levels, and model capability reporting.
- Reject the upgrade if unrelated adapter behavior changes without a clear
  compatibility decision.

### Phase 4: Optional native catalog merge

- If the aligned pi-ai catalog exposes `grok-4.6` under `xai`, optionally
  remove `xai-grok-4-6` from the combined patch.
- Confirm the Models page remains stable before and after the merge.
- Keep the explicit route if native support is absent or less reliable.
- Keep the current Codex default unless explicitly changed by the user.

## 10. Acceptance criteria

### Workspace and dependency checks

- `coding-plan` has one `pnpm-lock.yaml`.
- `coding-plan/core`, `codex`, and `grok` resolve one pi-ai version.
- DSH `llm-pi-ai` resolves that same pi-ai version.
- No child package independently owns an installable DSH patch for
  `llm-pi-ai`.

### Runtime checks

- Editing `models.json` followed by a DSH reload updates the exposed provider,
  model, and thinking-effort metadata.
- Invalid `models.json` is rejected before the `llm-pi-ai` configuration is
  published, with no partial provider table.
- `llm.providers` contains active `openai-codex`, `xai`, and
  `xai-grok-4-6` routes in the current stable configuration.
- `llm.models` exposes Grok 4.6 through `xai-grok-4-6` when the host catalog
  lacks native Grok 4.6 support.
- If the host catalog later gains native support, the Models page may expose
  all four Grok models under `xai`, but this is not required for acceptance.
- `GROK_CODING_PLAN_ACCESS_TOKEN` reports configured without exposing its value.
- `CODEX_CODING_PLAN_ACCESS_TOKEN` reports configured without exposing its value.
- Restarting DSH does not remove either provider.
- Disposing DSH removes synchronized credentials.

### Verification checks

- Core auth-cache tests pass.
- Codex auth-cache tests pass.
- Grok auth-cache tests pass.
- DSH `llm-pi-ai` typecheck passes.
- DSH `llm-pi-ai` tests pass.
- A catalog-only model listing test verifies the explicit Grok 4.6 route and,
  when available, the native merged xAI group.
- A short opt-in live request can verify provider authentication separately;
  catalog verification alone must not incur model usage.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| pi-ai catalog changes model protocol or capability fields | Pin one proven version, keep the explicit Grok 4.6 route, and run the DSH adapter suite before any optional upgrade. |
| One patch removes another provider | One root bundle owns the complete `llm-pi-ai` row. |
| Grok or Codex auth cache format changes | Keep provider-specific parsers in thin adapters and test real cache fixtures without storing secrets. |
| Two pi-ai versions resolve at runtime | Compare workspace and host lockfile resolutions in CI and inspect the live module graph. |
| Refresh races with the native CLI | Use the shared file lock and atomic write path; preserve unrelated cache fields. |
| A model is listed but its subscription cannot call the API | Keep credential status separate from catalog status and perform an opt-in live request when needed. |
| DSH never upgrades its pi-ai version | Keep the explicit `xai-grok-4-6` route permanently; it shares the DSH runtime and does not require a second pi-ai dependency. |
| Changing the host pi-ai version changes unrelated behavior | Treat the DSH adapter test suite and an opt-in Grok smoke request as release gates; keep the explicit route if the upgrade is not clean. |

## 12. Decision

Adopt the shared `coding-plan` workspace and combined DSH bundle. Use one
proven pi-ai version for the DSH host and all coding-plan packages. Treat the
explicit `xai-grok-4-6` route as a supported permanent fallback, not an
unstable fork. Merge it into the native `xai` group only if a future DSH
pi-ai upgrade passes compatibility and live-request verification.
