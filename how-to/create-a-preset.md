# How to Create and Load a DeepSeek Harness Preset

A DeepSeek Harness preset is a user-owned Cordis composition that controls the persona, prompt sections, model-facing tools, tool presentation, skills, and other agent-specific behavior used by new sessions.

> Baseline: DeepSeek Harness [`dsh-v0.1.0-rc.8`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.0-rc.8), commit `141eb6fef83422698aef7a981029e843e8161534`.

## Preset structure

```text
${DSH_HOME:-$HOME/.dsh}/.agent-presets/<preset-id>/
├── agent.cordis.yml    # required Cordis plugin composition
├── preset.yml          # optional display metadata
├── skills/             # optional preset-local skills
└── other assets        # optional local plugins and resources
```

The default user root is:

```text
~/.dsh/.agent-presets/
```

A deployment may configure a different user root, so use the Host's preset service when possible instead of assuming the path.

## 1. Choose a preset id

The id becomes the directory name and must match:

```regex
[a-z0-9][a-z0-9-]*
```

Valid examples:

```text
research-agent
minimal-coder
code-reviewer
```

Invalid examples:

```text
ResearchAgent
research_agent
-research
research/agent
../research
```

Treat the id as immutable because sessions and settings record it.

## 2. Copy an existing preset

Start from a known-good composition instead of building one from an empty file.

| Source | Good starting point |
|---|---|
| `standard` | Full native coding agent |
| `code` | Full coding capabilities exposed through Code Mode |
| `minimal` | Persistent shell plus `str_replace_editor` |
| `cordis` | Creator agent with runtime inspection and plugin authoring |

Never edit a shipped preset directly. An upgrade replaces the shipped directory.

### Copy through the Host API

With the Web Host running:

```sh
curl --fail --silent \
  --request POST \
  --header 'content-type: application/json' \
  --data '{
    "type": "client-request",
    "rpcId": "copy-my-preset",
    "method": "agentPreset.copy",
    "payload": {
      "from": "standard",
      "agentPreset": "my-preset",
      "name": "My Preset"
    }
  }' \
  http://127.0.0.1:3080/api/agentPreset.copy
```

The Host operation:

- Resolves the actual writable preset root.
- Validates the id.
- Refuses existing ids and never overwrites.
- Copies the entire directory, including skills and assets.
- Dereferences symlinks.
- Rolls back incomplete copies.
- Applies owner-only permissions.
- Removes the shipped display order and source display name.

There is currently no ordinary `dsh preset copy` CLI command. The Host API and Web settings surface call the same `AgentPresets.copy()` service.

### Manual fallback

If the Host is unavailable:

```sh
mkdir -p ~/.dsh/.agent-presets/my-preset
chmod 700 ~/.dsh/.agent-presets/my-preset

cp -R \
  /path/to/shipped/agent-presets/standard/. \
  ~/.dsh/.agent-presets/my-preset/

find ~/.dsh/.agent-presets/my-preset -type d -exec chmod 700 {} \;
find ~/.dsh/.agent-presets/my-preset -type f -exec chmod 600 {} \;
```

Preset files are executable configuration and should be owner-only.

## 3. Add display metadata

Edit `preset.yml`:

```yaml
name: My Coding Agent
description: Focused coding agent with filesystem and Web-search tools.
```

Metadata is optional and presentation-only. The directory name supplies the id, and the containing root supplies `trust`.

Do not add `id`, `trust`, or shipped roster `order` fields to a user preset's metadata.

## 4. Edit the agent composition

`agent.cordis.yml` is a direct top-level list of Cordis plugin rows:

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a focused coding agent powered by {{model}}.
      Your working directory is {{cwd}}.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: false
    searchTimeoutMs: 60000
```

This is a direct composition, not a patch document.

Correct:

```yaml
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
```

Incorrect inside a preset:

```yaml
- insert:
    - id: tool-fs
      name: '@deepseek-ai/dsh-tool-fs'
```

`insert` belongs in `cordis.patch.yml` layers, not in `agent.cordis.yml`.

## 5. Put behavior on the correct plane

Use this decision:

```text
Does one kind of agent contribute this registration?
    yes -> preset plane

Is it shared across sessions or consumed by Host APIs/transports?
    yes -> Host plane
```

### Usually belongs in a preset

```text
persona
agent instructions
model-facing tool plugins
prompt sections
tool presentation mode
compaction selection
preset-local skill discovery
services used only inside this preset
```

### Usually stays on the Host plane

```text
tool, agent, prompt, job, skill, and subagent registries
sessions and persistence
model routing and adapters
settings and credentials
storage and telemetry
sandbox and approval policy
HTTP, API, WebSocket, and browser-static Host
shared capability providers
```

A preset normally loads a model-facing Consumer while the Host supplies the capability service and provider.

Example:

```text
Host:
  ctx.fs
  fs-local or fs-sandbox
  fs-observation-policy

Preset:
  @deepseek-ai/dsh-tool-fs
    -> read
    -> read_image
    -> write
    -> edit
```

## 6. Install external plugin packages

A bare package name in a preset must be resolvable from the selected profile.

Install an external package into the profile:

```sh
dsh plugin --profile web add package-name
```

From a source checkout:

```sh
pnpm dsh plugin --profile web add package-name
```

Then add its preset row:

```yaml
- id: external-plugin
  name: 'package-name'
```

Installation and exposure are separate:

```text
Profile installation
    makes a package resolvable

Preset composition
    enables it for agents using that preset
```

If installation also activates a bundle row globally, decide whether every preset should inherit it. To keep it preset-specific, disable the global row in the profile's later patch while retaining the installed dependency:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: external-plugin
  disabled: true
```

Installing, removing, or upgrading a profile package requires restarting the profile.

## 7. Isolate preset-owned services

A tool-only Consumer normally remains a loose row:

```yaml
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
```

A plugin that publishes a service owned by the preset must not publish it into the process-global service realm. Put the provider and every Consumer that needs it in one isolated group:

```yaml
- id: workflow-group
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: workflow-provider
      name: '@deepseek-ai/dsh-workflow-worker-thread'
      config:
        provider: spawn

    - id: workflow-tool
      name: '@deepseek-ai/dsh-tool-workflow'
```

The rule is:

```text
preset-owned service provider
        +
all Consumers of that service
        =
one isolated group
```

Do not isolate a Consumer of a Host-owned service. That would prevent it from resolving the shared provider.

## 8. Add preset-local helpers

A preset can load a relative JavaScript plugin:

```yaml
- id: local-helper
  name: './local-helper.mjs'
```

```js
export const name = 'local-helper'
export const inject = ['tools']

export function apply(ctx) {
  // Preset-specific registration or listener.
}
```

Use `.mjs` for standalone ESM helpers under `~/.dsh`. A `.js` file is ESM only when an ancestor `package.json` declares `"type": "module"`.

Relative paths resolve from the preset directory. Bare package names resolve from the Host/profile installation.

## 9. Restrict inherited global tools

Agent tools resolve through layered scopes:

```text
agent scope
    -> preset scope
    -> global Host scope
```

If other profile bundles contribute unrelated global tools, use an agent-scoped allow-list:

```js
export const name = 'my-tool-surface'
export const inject = ['tools']

const ALLOWED_TOOLS = [
  'read',
  'write',
  'edit',
  'web_search',
]

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ALLOWED_TOOLS })
  })
}
```

Add it to `agent.cordis.yml`:

```yaml
- id: tool-surface
  name: './tool-surface.mjs'
```

The restriction filters inherited preset and Host names for that exact agent without disabling global plugins for other presets.

Tool restrictions organize presentation and dispatch but are not a security boundary. Host sandbox, approval, provider, and execution policy still own authority.

Avoid using a filter to split a tightly coupled package when its descriptions or prompt sections still instruct the model to call the hidden names. Prefer a selective package entry point or purpose-built tool plugin.

## 10. Set the default preset

Set the personal default in `~/.dsh/settings.yaml`:

```yaml
agent-presets:
  default: my-preset
```

Set a deployment composition default in `~/.dsh/cordis.patch.yml`:

```yaml
- id: agent-presets
  config:
    default: my-preset
```

The settings value layers over the composition default. Updating only settings is sufficient for a personal choice; updating both makes the two defaults agree if the user setting is later cleared.

## 11. Discover and load the preset

Preset roots are scanned on each roster read. There is no separate registration or install command for a preset directory.

### Check discovery

```sh
curl --fail --silent \
  --request POST \
  --header 'content-type: application/json' \
  --data '{
    "type": "client-request",
    "rpcId": "list-presets",
    "method": "agentPreset.list",
    "payload": {}
  }' \
  http://127.0.0.1:3080/api/agentPreset.list
```

Confirm the roster row has:

```text
id: my-preset
trust: user
broken: absent
```

The roster's `broken` field is only a YAML and row-shape check. It does not prove that packages resolve or dependencies activate.

### Load it through a real session

```sh
curl --fail --silent \
  --request POST \
  --header 'content-type: application/json' \
  --data '{
    "type": "client-request",
    "rpcId": "create-with-my-preset",
    "method": "session.create",
    "payload": {
      "cwd": "/path/to/workspace",
      "agentPreset": "my-preset"
    }
  }' \
  http://127.0.0.1:3080/api/session.create
```

Session creation performs the real mount and validates:

- Package resolution.
- Plugin configuration.
- Required service activation.
- Duplicate registrations.
- Preset-owned service isolation.
- Agent-scoped tool restrictions.
- Setup completion before agent publication.

A successful response includes:

```json
{
  "result": {
    "ok": true,
    "value": {
      "sessionId": "session-...",
      "agentPreset": "my-preset"
    }
  }
}
```

## 12. Inspect the Host composition

```sh
dsh --profile web --dump-config
```

From a source checkout:

```sh
pnpm dsh --profile web --dump-config
```

This shows Host providers, installed bundles, and profile/home patches. Preset rows are not part of the Host tree; they mount later under a standing preset scope.

## 13. Reload behavior

Preset discovery is live:

- A new directory appears on the next roster read.
- A removed directory disappears from the next roster read.
- Changing the default affects later sessions.

When `agent.cordis.yml` changes:

```text
existing sessions
    keep their original preset generation

new sessions
    observe the changed composition stamp
    mount a new generation
```

Restart the profile when:

- Installing, removing, or upgrading a plugin package.
- Changing bundle membership.
- Changing Host plugin source while module HMR is disabled.

A restart is normally unnecessary when:

- Creating a user preset.
- Editing `preset.yml`.
- Editing `agent.cordis.yml`.
- Changing the default setting.
- Editing watched profile/home patch files.

Changing only a sibling skill or asset may not change the composition stamp. Touch `agent.cordis.yml` or restart to guarantee a new generation for later sessions.

## Checklist

```text
[ ] Choose a valid, stable id.
[ ] Copy a shipped preset; do not edit the shipped source.
[ ] Set the display name and description.
[ ] Keep agent behavior in agent.cordis.yml as a direct entry list.
[ ] Keep shared services and providers on the Host plane.
[ ] Isolate any service genuinely owned by the preset.
[ ] Install external packages into the target profile.
[ ] Disable unwanted global bundle activation when needed.
[ ] Restrict inherited global tools if the preset needs a focused surface.
[ ] Set the default or pass agentPreset explicitly.
[ ] Confirm roster discovery.
[ ] Create a real blank session to mount-validate the preset.
[ ] Use a new session after every composition change.
```

## Summary

```text
1. Copy standard, code, minimal, or cordis to a new user preset id.
2. Edit preset.yml for display metadata.
3. Edit agent.cordis.yml as a direct Cordis plugin list.
4. Install external packages in the profile before naming them.
5. Keep shared providers on the Host and agent tools/prompts in the preset.
6. Isolate preset-owned services with all of their Consumers.
7. Filter inherited global tools when necessary.
8. Set agent-presets.default or pass agentPreset to session.create.
9. Validate by creating a real blank session.
10. Create a new session to receive every updated preset generation.
```

The core idea is:

> A preset is a user-owned Cordis plugin composition mounted as an agent capability layer. Put it in a configured user preset root, make every row loadable, and create a new session that names its id.

## Sources

- [Agent preset package](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.0-rc.8/packages/preset/agent-presets)
- [Cordis composition authoring workflow](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md)
- [Shipped standard preset](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/config/agent-presets/standard/agent.cordis.yml)
- [Tool registry and scoped restrictions](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/tools/src/index.ts)
- [CLI profile boot and patch watching](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/src/profile-boot.ts)
