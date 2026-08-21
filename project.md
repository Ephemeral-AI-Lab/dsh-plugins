# DeepSeek Harness Project Guide

This document is our architectural index for DeepSeek Harness. It explains where code lives, how a running application is composed, and the Cordis concepts needed to read or extend the project.

> Baseline: [`dsh-v0.1.0-rc.8`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.0-rc.8), commit `141eb6fef83422698aef7a981029e843e8161534`. Paths and behavior in this document were verified against that source revision.

## Contents

- [1. Project at a glance](#1-project-at-a-glance)
- [2. Repository structure](#2-repository-structure)
- [3. Package-group index](#3-package-group-index)
- [4. Important packages](#4-important-packages)
- [5. Runtime composition](#5-runtime-composition)
- [6. Cordis](#6-cordis)
- [7. Source-reading paths](#7-source-reading-paths)

## 1. Project at a glance

DeepSeek Harness is a TypeScript and Node.js agent runtime built as a Cordis plugin tree. The model adapter, agent loop, tool registry, persistence, policies, application surfaces, and most supporting behavior are plugins selected through configuration.

The central architectural properties are:

1. **Everything is composed.** Product behavior enters through Cordis plugins instead of a privileged application core.
2. **Capabilities are replaceable.** A capability normally separates its definition, provider, and consumer so a provider can change without rewriting its callers.
3. **Registrations are reversible.** Services, event listeners, tools, prompt sections, and other contributions belong to the plugin Fiber that registered them and disappear when it unloads.
4. **The session event log is authoritative.** Model history, replay, persistence, UI projections, session forks, titles, and telemetry derive from append-only session events.
5. **Model-visible state is durable.** Anything included in a model request must be reconstructable from the session log.
6. **Host and agent composition are separate.** Shared infrastructure lives on the Host plane; the capabilities and prompt presented to one kind of agent live in an agent preset.

### Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js `^22.19.0` or `>=24` |
| Language | TypeScript 6, strict ESM, ES2024 target |
| Workspace manager | Corepack and `pnpm@11.7.0` |
| Plugin framework | Vendored Cordis 4 release candidate |
| Configuration | YAML `cordis.yml` and `cordis.patch.yml` documents |
| Configuration schemas | Schemastery |
| Build | TypeScript project references, tsdown, and Vite |
| Web client | React 18, Zustand, Immer, and CSS modules |
| Host server | Native `node:http` with plugin-owned routes and upgrades |
| Persistence | Native `node:sqlite` and JSONL backends |
| RPC and reflection | Typert-generated type graph and JSON-RPC surfaces |
| Testing | Vitest, V8 coverage, jsdom, Testing Library, Fast-check, Playwright |
| Static checks | Oxlint/tsgolint, Knip, Publint, JSCPD, repository-specific gates |
| Documentation | Markdown, bilingual pairs, generated catalogs, VitePress |
| Python | Python 3.10+, Pydantic 2, Hatchling, pytest, JSON-RPC SDK |

## 2. Repository structure

```text
deepseek-harness/
├── .agents/                 Agent skills and architectural/process Agent Notes
├── .claude/                 Compatibility exposure of repository agent skills
├── .github/                 CI, releases, issue policy, and repository templates
├── apps/
│   ├── cli/                 Published dsh CLI and shipped composition assets
│   └── web/                 Browser entry application and browser E2E suites
├── docs/                    Canonical architecture, tutorials, references, and user docs
├── examples/                Runnable composition leaves and snapshot fixtures
├── native/
│   └── landlock-run/        Native Linux confinement launcher and platform packages
├── packages/                Grouped @deepseek-ai/dsh-* workspaces
├── patches/                 Reviewed pnpm dependency patches
├── python/
│   ├── sdk/                 Python client SDK
│   └── sdk-runtime/         Packaged executable runtime
├── scripts/                 Builds, checks, generators, migrations, and release tooling
├── vendor/                  Pinned and locally modified Cordis source workspaces
└── website/                 VitePress adapter and publication manifest
```

### Top-level ownership

| Path | Responsibility | Start here |
|---|---|---|
| `.agents/` | Reusable agent workflows and the decision records describing why the architecture exists | `.agents/notes/README.md` |
| `.github/` | Continuous integration, releases, issue lifecycle, templates, and Dependabot | `.github/workflows/` |
| `apps/cli/` | The `@deepseek-ai/dsh` package, command parsing, profile boot, and shipped presets | `apps/cli/src/bin.ts` |
| `apps/web/` | Browser build entry, static assets, and browser application tests | `apps/web/package.json` |
| `docs/` | Canonical architecture and contributor/user documentation | `docs/architecture.md` |
| `examples/` | Runnable `cordis.yml` leaves used by demos, E2E checks, and snapshots | `examples/AGENTS.md` |
| `native/` | Native components that cannot be implemented safely or portably in TypeScript | `native/README.md` |
| `packages/` | Product capability, Host, Client, protocol, and support packages | `packages/README.md` |
| `patches/` | pnpm patches applied to third-party packages | `pnpm-workspace.yaml` |
| `python/` | Python SDK plus the bundled runtime distribution | `python/README.md` |
| `scripts/` | Repository-wide source generators and executable validation rules | `package.json` scripts |
| `vendor/` | Vendored Cordis, Loader, Include, HMR, and supporting packages | `vendor/README.md` |
| `website/` | Presentation-only VitePress layer over selected canonical documents | `website/AGENTS.md` |

### Package layout

Most product packages use the following structure:

```text
packages/<group>/<package>/
├── package.json
├── README.md
├── README.zh.md
├── README.i18n.yaml
├── tsconfig.json
├── src/
│   ├── index.ts
│   └── invariant.ts
└── tests/
    └── *.spec.ts
```

The group organizes related roles but is normally omitted from the npm name:

```text
packages/web/web-fetch-http
└── @deepseek-ai/dsh-web-fetch-http
```

New reusable runtime code belongs under `packages/`. The root `examples/` directory contains runnable composition leaves rather than reusable implementation packages.

## 3. Package-group index

The following index is organized by architectural purpose. Group-level `README.md` files remain the authoritative package-to-service maps.

### Core runtime and model execution

| Group | Responsibility |
|---|---|
| `core` | Sessions, prompt assembly, tools, agents, agent scopes, and the concrete agent loop |
| `llm` | Provider-neutral LLM types and service plus concrete model adapters |
| `context` | Model-visible runtime context such as workspace instructions and time |
| `compaction` | Context-compaction definition, providers, policies, and commands |
| `guard` | Loop hygiene, repeated-call reminders, and tool deadlines |
| `identity` | Shared anonymous user identity |

### Durable state and configuration

| Group | Responsibility |
|---|---|
| `session` | Session persistence, projections, titles, telemetry, and reporting |
| `session-query` | Session retrieval, bounded reads, lineage, relationships, and search |
| `storage` | Non-session storage service and JSON/SQLite/domain implementations |
| `workspace` | Workspace identity and lifecycle |
| `attachment` | Durable attachment identity, validation, and content-addressed storage |
| `settings` | User-settings service and file-backed implementation |
| `credentials` | Credential references and environment/`.env` resolution |
| `feedback` | Durable human feedback |

### Execution capabilities

| Group | Responsibility |
|---|---|
| `subprocess` | Subprocess capability and local process-tree provider |
| `shell` | Shell service, local/sandboxed implementations, and model-facing tools |
| `terminal` | Persistent PTY registry, local implementation, and terminal tools |
| `code-runtime` | Code-execution service and worker-thread/Python runtimes |
| `sandbox` | Process-confinement policies and platform backends |
| `fs` | Filesystem definition, local/sandbox providers, file tools, and search |
| `lsp` | Language-server service, stdio provider, and model-facing LSP tool |
| `e2b` | E2B proof-of-concept providers |
| `web` | Web search/fetch definitions, providers, and model-facing tools |
| `mcp` | Model Context Protocol client integration |
| `skill` | Skill-provider registry, filesystem provider, catalog, and loader tool |
| `spill` | Large-result spill policy, storage service, and local implementation |

### Agent orchestration and collaboration

| Group | Responsibility |
|---|---|
| `goal` | Same-session goals, durable lifecycle, commands, and tools |
| `plan` | Plan-mode state and reviewed mode transitions |
| `todo` | Model-facing todo management |
| `schedule` | Session-local scheduled follow-ups |
| `interaction` | Approvals, permissions, user questions, and human commands |
| `subagent` | Subagent provider registry, providers, and delegation tools |
| `jobs` | Background-job runtime and `job_*` tools |
| `workflow` | Workflow service, worker-thread execution, and workflow tools |
| `experimental` | Private prototypes such as experimental agent-team support |

### Composition and extension

| Group | Responsibility |
|---|---|
| `boot` | Shared application boot and composition validation |
| `bundle` | Installable profile patch layers such as base, Web, and headless |
| `preset` | Per-agent composition from preset `agent.cordis.yml` files |
| `extensions` | Runtime inspection and model-written plugin mount/unmount tools |
| `hooks` | Claude Code/Codex hook bridges and shared wire protocols |

### Host, Client, and external protocols

| Group | Responsibility |
|---|---|
| `api` | Remote backend-for-frontend assembly and Typert RPC gateway |
| `typert` | Type-graph generation, artifact loading, and runtime registry |
| `host` | Node Host half of the Web application: API, HTTP, WebSocket, static files |
| `client` | Browser Cordis runtime, connection layer, slots, stores, and UI plugins |
| `sdk` | Out-of-process JSON-RPC protocol, TypeScript client, and server plugin |
| `acp` | Automation-only Agent Client Protocol server |

### Support and examples

| Group | Responsibility |
|---|---|
| `examples` | Reusable demo bundles loaded by runnable examples |
| `test-support` | Testkits, Loader smokes, replay, fixtures, and invariant support |
| `runtime-diagnostics` | Runtime invariant registration and reporting |
| `util` | Small, low-dependency shared utilities |

## 4. Important packages

### Product spine

| Package path | Runtime responsibility | Main Cordis key |
|---|---|---|
| `packages/core/session` | Append-only session event log and in-memory session store | `ctx.sessions` |
| `packages/core/system-prompt` | Prompt sections, ordering, and tool-schema assembly | `ctx.systemPrompt` |
| `packages/core/tools` | Scoped tool registry and guarded execution pipeline | `ctx.tools` |
| `packages/core/agent` | Agent interface, live agent registry, and `agent/*` events | `ctx.agents` |
| `packages/core/agent-loop` | Default driver for turns, steps, model requests, and tool calls | `ctx.agentLoop` |
| `packages/core/scope` | Per-agent registration visibility and cleanup ownership | Library; no service key |
| `packages/llm/llm` | Model/message/stream vocabulary and adapter registry | `ctx.llm` |
| `packages/llm/llm-deepseek` | Native DeepSeek provider adapter | Registers with `ctx.llm` |

### Composition and product surfaces

| Package path | Responsibility |
|---|---|
| `packages/boot/app-boot` | Creates the Cordis root, mounts Loader/Include, validates activation, and rolls back failed boot |
| `packages/bundle/base` | Shared Host layer: model, session, tools, persistence, policy, settings, and telemetry |
| `packages/bundle/web-app` | Web Host and Client composition |
| `packages/bundle/headless` | One-shot headless composition |
| `packages/preset/agent-presets` | Discovers and mounts per-agent preset compositions |
| `apps/cli` | Resolves profiles, stacks patch layers, boots the selected product surface |
| `apps/web` | Builds the browser application consumed by the Web Host |

### State and transport

| Package path | Responsibility |
|---|---|
| `packages/session/session-persistence-jsonl` | JSONL session persistence |
| `packages/session/session-persistence-sqlite` | SQLite session persistence and physical event packing |
| `packages/session/session-projection` | Derives views from durable events |
| `packages/settings/settings-file` | Hot-reloaded settings document |
| `packages/credentials/credentials-local` | Environment and `.env` credential resolution |
| `packages/api/gateway` | RPC gateway assembly |
| `packages/host/apiproxy` | Host API proxy and session operations |
| `packages/host/webserver` | HTTP and upgrade registration over `node:http` |
| `packages/client/connection` | Browser-to-Host RPC and event streams |
| `packages/client/runtime` | Shared observable Client runtime state |

### Capability examples

| Capability | Definition | Provider | Consumer |
|---|---|---|---|
| Filesystem | `packages/fs/fs` | `packages/fs/fs-local`, `packages/fs/fs-sandbox` | `packages/fs/tool-fs`, `packages/fs/tool-fs-search` |
| Subprocess | `packages/subprocess/subprocess` | `packages/subprocess/subprocess-local` | Shell, terminal, LSP, and other execution packages |
| Shell | `packages/shell/shell` | `packages/shell/bash-local`, `packages/shell/bash-sandbox` | `packages/shell/tool-bash` and persistent-shell tools |
| LSP | `packages/lsp/lsp` | `packages/lsp/lsp-stdio` | `packages/lsp/tool-lsp` |
| Web | `packages/web/web` | DeepSeek/Exa/Perplexity search and HTTP fetch providers | `packages/web/tool-web` |
| Subagents | `packages/subagent/subagent` | In-process, ACP, Codex, and Claude Code providers | `packages/subagent/tool-subagent` |
| Workflow | `packages/workflow/workflow` | `packages/workflow/workflow-worker-thread` | `packages/workflow/tool-workflow` and `tool-ralph` |

## 5. Runtime composition

Runtime composition has two related meanings:

1. **Boot composition:** which plugins form a running `dsh` process.
2. **Agent execution:** how one message becomes durable events, model requests, and tool results.

### 5.1 Profiles and bundles

A **profile** is a named installed composition under the Harness home. It declares an ordered bundle list and carries the user's own `cordis.patch.yml`.

A **bundle** distributes Cordis patch rows plus the packages those rows load. Its `package.json` points to its patch through `dsh.bundle.patch`.

The shipped product shapes are:

| Profile/bundle | Purpose |
|---|---|
| `dsh-base` | Shared model, session, persistence, sandbox, settings, credentials, telemetry, and Host registries |
| `dsh-web-app` | Browser application, API Host, HTTP/WebSocket transport, and Client runtime |
| `dsh-headless` | One-shot runner without the Web server |
| `web` profile | Base plus Web application bundles |
| `headless` profile | Base plus headless runner bundles |

### 5.2 Layer order

The application starts from an empty Cordis entry list and applies layers in this order:

```text
empty root cordis.yml
        │
        ▼
bundle 1 patch
        │
        ▼
bundle 2 patch
        │
        ▼
...remaining bundle patches, in profile order
        │
        ▼
$DSH_HOME/profiles/<profile>/cordis.patch.yml
        │
        ▼
$DSH_HOME/cordis.patch.yml
        │
        ▼
command-line --patch overlays, in argument order
        │
        ▼
launcher hard overrides such as telemetry disable
        │
        ▼
effective Cordis plugin tree
```

Later layers can target rows inserted by earlier layers. A row's stable `id` is its reconciliation identity.

Use the CLI to inspect the exact tree before editing it:

```sh
dsh --profile web --dump-config
```

From the source checkout:

```sh
pnpm dsh --profile web --dump-config
```

### 5.3 Direct compositions versus patches

A raw `cordis.yml` is a direct list of plugin entries:

```yaml
- id: logger
  name: '@deepseek-ai/cordis-plugin-logger-console'

- id: feature
  name: './feature.js'
  config:
    enabled: true
```

A profile, bundle, home, or command-line overlay is a patch list. New rows use `insert`:

```yaml
- insert:
    - id: feature
      name: 'my-feature-package'
      config:
        enabled: true
```

An existing row is targeted by `id`:

```yaml
- id: feature
  disabled: true
```

The target row's `config` is replaced as a complete block when a patch supplies a new one. Do not assume nested deep-merge semantics.

### 5.4 Boot sequence

At a high level, `dsh` performs the following work:

1. Parse the CLI invocation and resolve the profile.
2. Resolve installed bundles and their ordered patch files.
3. Create or refresh the profile's empty root `cordis.yml`, which anchors Loader resolution.
4. Parse the profile, home, CLI, and launcher-owned overlays.
5. Create the root Cordis `Context`.
6. Provide launcher-owned values such as the Harness home and command-line snapshot.
7. Mount Cordis Loader, Include, and Group support.
8. Apply the composed patch stack to the empty root.
9. Import and mount each resulting plugin entry.
10. Wait for the entire Loader tree to settle.
11. Reject failed entries and enabled entries still waiting for missing services.
12. Dispose the partial tree if boot fails; otherwise install live configuration watchers.

This is stricter than bare Cordis. Bare Cordis permits a plugin to remain `PENDING` while it waits for a service; Harness treats unresolved enabled rows as a broken product composition and fails boot with the missing-service information.

### 5.5 Host plane and agent-preset plane

The running process separates shared infrastructure from per-agent presentation.

```text
Host plane — one shared process composition
├── model routing and adapter registry
├── agent, tool, prompt, job, skill, and subagent registries
├── persistence, storage, settings, credentials, and telemetry
├── sandbox and approval policy
├── API, HTTP, WebSocket, and browser-static Host
└── optional product providers such as Codex or Claude Code subagents

Agent preset plane — one selected capability composition
├── persona and prompt sections
├── model-facing tools
├── tool-presentation mode
├── compaction policy
├── per-agent skill discovery
└── preset-owned services isolated from the process-global realm
```

Registries and cross-session services stay on the Host plane. A preset contributes entries into those registries for agents using that preset. Shared persistence, policy, model routing, or provider registries must not be moved into a preset merely because an agent consumes them.

### 5.6 Runtime turn flow

A **turn** contains zero or more **steps**. A step is one model request followed by the tool calls the model requests.

```text
Legend: [D] durable session event   [L] live Cordis event   [R] registry/read

  +----------------------+       +----------------------+       +----------------------+
  | User/API prompt or   |       | steer                |       | inject               |
  | followup             |       | (wakes the driver)   |       | (does not wake it)   |
  | (next-turn FIFO)     |       | (next-step inbox)    |       | (next-step inbox)    |
  +----------+-----------+       +----------+-----------+       +----------+-----------+
             |                              |                              |
             +------------------------------+------------------------------+
                                            |
                                            v
                              +---------------------------+
                              | Agent inbox / queued input |
                              +-------------+-------------+
                                            |
                                            v
                                  +------------------+
                                  | [D] turn/start   |
                                  +--------+---------+
                                           |
                                           v
                    +------------------------------------------------+
                    | Claim next-step input plus one queued prompt    |
                    | (between steps, claim next-step input only)     |
                    +----------------------+-------------------------+
                                           |
                                           v
                    +------------------------------------------------+
                    | [R] Read prompt sections and tool schemas       |
                    |     visible through agent -> preset -> global   |
                    +----------------------+-------------------------+
                                           |
                                           v
                    +------------------------------------------------+
                    | [L] agent/pre-step waterfall                    |
                    |     listeners may reject or rewrite messages    |
                    +----------------------+-------------------------+
                                           |
                       +-------------------+-------------------+
                       |                                       |
                reject / empty first input                  enter messages
                       |                                       |
                       v                                       v
              +------------------+                    +------------------+ <-----------+
              | [D] turn/end     |                    | [D] step/start   |             |
              | (no model step)  |                    +--------+---------+             |
              +------------------+                             |                       |
                                                               v                       |
                                              +----------------------------------+      |
                                              | [D] user/message*               |      |
                                              | Append admitted input to log    |      |
                                              +----------------+-----------------+      |
                                                               |                       |
                                                               v                       |
                                              +----------------------------------+      |
                                              | [R] Derive model history from   |      |
                                              |     the session event log       |      |
                                              +----------------+-----------------+      |
                                                               |                       |
                                                               v                       |
                                              +----------------------------------+      |
                                              | [L] agent/request waterfall     |      |
                                              | Build/intercept model request   |      |
                                              +----------------+-----------------+      |
                                                               |                       |
                                                               v                       |
                                              +----------------------------------+      |
                                              | [L] llm/stream waterfall        |      |
                                              | Invoke selected model adapter   |      |
                                              +----------------+-----------------+      |
                                                               |                       |
                                                               v                       |
                                              +----------------------------------+      |
                                              | [D] assistant/chunk*            |      |
                                              | [D] assistant/message           |      |
                                              +----------------+-----------------+      |
                                                               |                       |
                                                               v                       |
                                              +----------------------------------+      |
                                              | Did the model request tools?    |      |
                                              +---------+----------------+-------+      |
                                                        |                |              |
                                                       no               yes             |
                                                        |                |              |
                                                        |                v              |
                                                        |   +------------------------+  |
                                                        |   | For each tool call     |  |
                                                        |   | [D] tool/call          |  |
                                                        |   +-----------+------------+  |
                                                        |               |               |
                                                        |               v               |
                                                        |   +------------------------+  |
                                                        |   | [L] tools/pre-execute  |  |
                                                        |   | [L] tools/execute      |  |
                                                        |   | [L] tools/post-execute |  |
                                                        |   +-----------+------------+  |
                                                        |               |               |
                                                        |               v               |
                                                        |   +------------------------+  |
                                                        |   | [D] tool/result        |  |
                                                        |   +-----------+------------+  |
                                                        |               |               |
                                                        +---------------+               |
                                                                        |               |
                                                                        v               |
                                                        +---------------------------+   |
                                                        | [D] step/end              |   |
                                                        +-------------+-------------+   |
                                                                      |                 |
                                                                      v                 |
                                      +------------------------------------------------+ |
                                      | Another model request is owed, or next-step    | |
                                      | input arrived while the step was running?      | |
                                      +----------------------+-------------------------+ |
                                                             |                           |
                                                  +----------+----------+                |
                                                  |                     |                |
                                                 no                    yes               |
                                                  |                     |                |
                                                  v                     v                |
                                      +------------------------+   +------------------+   |
                                      | [L] agent/turn-stopping|   | Claim next-step  |---+
                                      +-----------+------------+   | input            |
                                                  |                +------------------+
                                                  v
                                      +------------------------+
                                      | [D] turn/end           |
                                      +-----------+------------+
                                                  |
                                                  v
                                                IDLE
```

Durable events include turn and step boundaries, user messages, assistant output, tool calls, and tool results. Live Cordis events provide policy and interception around the durable flow.

### 5.7 Session log as the source of truth

The append-only session log supplies the history sent to the model. It also drives:

- Persistence and resume.
- Browser projections.
- Transcript export.
- Replay and snapshots.
- Telemetry.
- Session titles.
- Forking and lineage.
- Reconstruction of the tool/preset context used by a session.

A new model-visible input normally requires a durable session event. Holding a fact only in transient plugin memory would make replay and resume produce a different model request.

### 5.8 Reload boundaries

| Change | Runtime behavior |
|---|---|
| Profile `cordis.patch.yml` | Watched and transactionally recomposed |
| Home `$DSH_HOME/cordis.patch.yml` | Watched and transactionally recomposed |
| Invalid watched patch update | Previous good composition remains active |
| `--patch` file edited after startup | Not watched; restart required |
| Bundle patch edited after startup | Not watched; restart required |
| Bundle added, removed, or upgraded | Restart the profile |
| Host/plugin TypeScript source in shipped Web/headless | Module HMR disabled by default; restart required |
| Client browser source | Use `pnpm run dev:web` |
| Stable Loader row config changed | Validate, unload its effects, and restart the Fiber |
| Plugin module changed under an explicitly configured HMR root | Invalidate module cache, import the new module, and remount affected Fibers |
| Agent preset composition changed | Existing sessions keep their generation; later sessions mount the new generation |

The shipped Web and headless layers disable general Host module HMR because that lifecycle is not part of their supported runtime contract. The CLI still mounts a watch-only HMR service so profile and home patch changes remain live.

## 6. Cordis

Cordis is the dependency-injection, lifecycle, event, and configuration framework underneath DeepSeek Harness.

### 6.1 Mental model

| Term | Meaning |
|---|---|
| `Context` | Service resolution plus the ownership path for registrations |
| Plugin | Code that Cordis can mount into a Context |
| `Fiber` | One live mounting of a plugin, including config, dependencies, effects, and state |
| Service | A named capability published on `ctx` |
| `inject` | Required services that control when a Fiber may become active |
| Effect | A registration/resource paired with automatic cleanup |
| Event | A typed extension point dispatched through a defined mode |
| Loader | The service that turns configuration entries into imported plugin Fibers |
| Include | YAML parsing and inclusion of composition files |
| Group | A nested entry tree sharing composition metadata such as isolation |
| Isolation realm | A service-resolution namespace for selected service names |

There is no Cordis “forked plugin” runtime type. The lifecycle handle is a Fiber. Session forks and subagent forks are product-level Harness operations that create new agents and durable histories.

### 6.2 Five central ideas

1. **A plugin encapsulates behavior.** It can be a function, class/constructor, or object with `apply(ctx, config)`.
2. **A Context resolves services.** Plugins depend on stable `ctx.<key>` capabilities instead of importing concrete providers.
3. **`inject` expresses load order.** Consumers wait for services rather than relying on YAML row order.
4. **Typed events provide extension points.** Plugins observe, intercept, replace, or serialize work through declared event contracts.
5. **Registrations are reversible effects.** Unloading a Fiber removes everything it registered.

### 6.3 Context

`new Context()` creates the root service container and its built-in registry, reflection, events, and logging machinery. Each mounted plugin receives a child Context that shares the root graph while recording which Fiber owns work performed through it.

A child Context is not a second application and does not clone services. It changes ownership and metadata ancestry.

Required service access is injection-checked:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['greeter']

export function apply(ctx: Context): void {
  console.log(ctx.greeter.greet('world'))
}
```

Optional lookup is explicit:

```ts
const greeter = ctx.get('greeter')

if (greeter !== undefined) {
  console.log(greeter.greet('world'))
}
```

Use `ctx.<name>` for declared required dependencies. Use `ctx.get(name)` when absence is a supported runtime case.

### 6.4 Plugin shapes

#### Function plugin

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'
export const inject = ['tools']

export function apply(ctx: Context): void {
  console.log('hello plugin loaded')
}
```

Repository function plugins named-export `name`, optional `inject`, optional `Config`, and `apply`. They do not also export a default value because Loader unwraps `.default` and would lose sibling function-plugin metadata.

#### Service class

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

export default class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(name: string): string {
    return `Hello, ${name}!`
  }
}
```

Declaration merging adds the TypeScript property. The string passed to `super(ctx, 'greeter')` is the runtime service identity.

#### Object plugin

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'hello',
  apply(ctx: Context) {
    console.log('hello plugin loaded')
  },
}
```

### 6.5 Fiber lifecycle

```text
PENDING
   │ required services become available
   ▼
LOADING
   ├──────────────► FAILED
   │
   ▼
ACTIVE
   │ update, dependency loss, restart, or dispose
   ▼
UNLOADING
   │
   ├─ dependency/config restart ─► PENDING or LOADING
   └─ permanent disposal ─────────► DISPOSED
```

A Fiber owns:

- The plugin child Context.
- Validated configuration.
- The current dependency-provider snapshot.
- Child plugins.
- Effects and disposers.
- Lifecycle state.

The same plugin definition may be mounted more than once, producing multiple independent Fibers.

### 6.6 Services and dependency activation

`inject` is lifecycle dependency injection rather than constructor injection. It means:

> Do not run this plugin until every named service has an active provider.

When a provider disappears or is replaced:

1. Dependent Fibers unload.
2. Their effects and registrations are removed.
3. They return to `PENDING` while dependencies are absent.
4. They load again when a complete provider set becomes active.

Consequences:

- Sibling row order is not activation order.
- A consumer can appear before its provider in YAML.
- Replacing one provider automatically restarts affected consumers.
- Duplicate providers in the same service realm fail rather than being selected implicitly.
- Harness boot rejects enabled rows that remain `PENDING` after composition settles.

### 6.7 Effects and cleanup

Use `ctx.effect()` for resources Cordis does not already own:

```ts
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('tick')
    }, 5_000)

    return () => clearInterval(timer)
  })
}
```

The disposer runs when the Fiber restarts, loses a dependency, or is permanently disposed.

The following are already lifecycle-owned effects:

- `ctx.on(...)` event listeners.
- `ctx.plugin(...)` child Fibers.
- `ctx.provide(...)` services.
- Cordis `Service` registrations.
- Harness registry methods implemented through `ctx.effect()`.

Raw timers, sockets, filesystem watchers, native subscriptions, and external event sources need explicit ownership.

Disposal begins in reverse registration order. If two cleanup actions require strict sequencing, keep them inside one disposer rather than depending on ordering between separate asynchronous effects.

### 6.8 Events

Events are typed through declaration merging:

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}
```

| Mode | Behavior |
|---|---|
| `emit` | Synchronous broadcast; return values are ignored |
| `parallel` | Run listeners concurrently and await all of them |
| `serial` | Await listeners in registration order and stop on a bail value |
| `bail` | Synchronous ordered dispatch that stops on a bail value |
| `waterfall` | Around-middleware in which listeners call `next()` to delegate |

Waterfall listeners receive `next()`:

```ts
ctx.on('example/request', async (request, next) => {
  request.headers['x-example'] = '1'
  return await next()
})
```

Calling `next()` delegates to downstream listeners and ultimately the base operation. Returning without calling `next()` intentionally short-circuits the chain. An observer or annotator must delegate; a policy listener may short-circuit when it owns the decision.

Harness uses three event domains:

| Domain | Use |
|---|---|
| Session events | Durable facts that must survive restart and replay |
| Agent events | Live request, step, inbox, status, and continuation behavior |
| Capability events | Policy and adapters around services such as tools, filesystem, and telemetry |

### 6.9 Three meanings of scope

Do not conflate these mechanisms:

```text
Cordis child Context
    ownership and metadata ancestry

Cordis service isolation realm
    service-resolution namespace for selected keys

Harness agent scope
    per-agent registry visibility and cleanup ownership

Harness session/subagent fork
    a new agent and durable history derived from another session
```

#### Cordis service isolation

`ctx.isolate(name, label?)` changes how one service name resolves below a child Context. Loader exposes isolation through row metadata.

```yaml
- id: workflow-group
  name: cordis:group
  group: true
  isolate:
    workflows: true
  config:
    - id: workflow-provider
      name: '@deepseek-ai/dsh-workflow-worker-thread'

    - id: workflow-tool
      name: '@deepseek-ai/dsh-tool-workflow'
```

`true` creates an entry-local realm. The provider and every consumer that must see it belong under the same isolated group. A string label joins resolution realms but does not permit duplicate providers within that realm.

#### Harness agent scope

Harness agent scope is a layer above Cordis. It lets one shared registry expose different tools, prompt sections, skills, or projections to different agents. It does not clone `ctx.tools`, `ctx.llm`, persistence, or other Host services.

An agent preset mounts a standing registration layer, and each agent using it resolves:

```text
agent layer → preset layer → global Host layer
```

### 6.10 Loader entries

A raw Loader entry has the following conceptual shape:

```ts
interface EntryOptions {
  id: string
  name: string
  config?: unknown
  group?: boolean
  disabled?: boolean
  inject?: string[] | Record<string, unknown>
  isolate?: Record<string, true | string>
}
```

`name` may be:

- A relative module specifier.
- An absolute filesystem path.
- A bare npm package name.
- A registered built-in such as `cordis:group`.

Always supply a stable `id`. Loader uses it to reconcile changes:

| Change under the same `id` | Result |
|---|---|
| `config` | Validate and restart the existing Fiber |
| `disabled` | Unload or remount the Fiber |
| `name` | Replace the Fiber with a different plugin |
| `inject` | Replace/rebind the Fiber's dependency contract |
| `group` | Replace the entry structure |
| Row removed | Dispose the Fiber |
| Row inserted | Mount a new Fiber |

Loader updates are transactional: a failing candidate is rolled back so the previous live entry can remain active.

### 6.11 `!!js` configuration

The Include plugin parses `!!js` expressions, but they are deliberately restricted:

- Nested `config` values are evaluated after declared injections become available and against the plugin Context.
- `disabled: !!js ...` is evaluated against the Loader Context at each mount decision.
- Structural metadata such as `id`, `name`, `inject`, and `isolate` stays literal.

Example:

```yaml
- id: terminal-bash
  name: '@deepseek-ai/dsh-terminal-bash'
  disabled: !!js process.platform === 'win32'
  config:
    timeoutMs: 300000
```

Environment-dependent plugin selection that cannot be expressed through `disabled` belongs in an overlay rather than dynamic structural metadata.

### 6.12 Loading and reloading APIs

Programmatic Cordis lifecycle:

```ts
const fiber = await ctx.plugin(plugin, config)

await fiber.update(nextConfig)
await fiber.restart()
await fiber.dispose()
```

- `update(nextConfig)` validates new configuration and re-runs the plugin.
- `restart()` re-runs the current imported plugin with its current config.
- `dispose()` permanently tears down the Fiber.
- `restart()` does not invalidate a changed JavaScript/TypeScript module; module HMR must clear the module cache and import the new code.

Loader-managed lifecycle maps configuration changes onto these operations. The HMR plugin additionally watches configured module roots, finds affected dependency graphs, clears caches, imports new modules, and remounts their Fibers.

### 6.13 Practical Cordis rules

1. Give every Loader row a stable `id`.
2. Declare required services with `inject`; do not depend on YAML order.
3. Use `ctx.get(name)` only when absence is valid behavior.
4. Ensure every registration or external resource has lifecycle cleanup.
5. Call `next()` in waterfall listeners unless intentionally short-circuiting.
6. Put shared and cross-session services on the Host plane.
7. Isolate preset-owned service providers with all of their consumers.
8. Treat raw `cordis.yml` files and patch files as different document types.
9. Use `--dump-config` to inspect the effective tree rather than guessing which layer won.
10. Remember that config reload and module-source reload are different mechanisms.

## 7. Source-reading paths

These references are pinned to the document baseline.

### Architecture and project structure

- [Repository instructions and top-level map](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/AGENTS.md)
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/architecture.md)
- [Package-group index](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/README.md)
- [Generated module graph](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/module-graph.md)
- [Contributor development guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/development.md)

### Runtime composition

- [CLI profile boot](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/src/profile-boot.ts)
- [Application boot](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/boot/app-boot/src/index.ts)
- [Base bundle patch](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/bundle/base/cordis.patch.yml)
- [Web bundle patch](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/bundle/web-app/cordis.patch.yml)
- [Headless bundle patch](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/bundle/headless/cordis.patch.yml)
- [Agent lifecycle and turn flow](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/agent-lifecycle.md)

### Cordis

- [Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/cordis-primer.md)
- [Cordis tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/cordis-tutorial/index.md)
- [Context implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/cordis/src/context.ts)
- [Fiber implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/cordis/src/fiber.ts)
- [Service implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/cordis/src/service.ts)
- [Event implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/cordis/src/events.ts)
- [Loader entry reconciliation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/loader/src/config/entry.ts)
- [Include and YAML dialect](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/include/src/index.ts)
- [HMR implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/vendor/hmr/src/index.ts)
