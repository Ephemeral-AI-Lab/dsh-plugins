# DeepSeek Harness Tool Guide

This document catalogs the model-facing tools supplied by DeepSeek Harness, their arguments, how presets expose them, and how the tool runtime organizes visibility and execution.

> Baseline: [`dsh-v0.1.0-rc.8`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.0-rc.8), commit `141eb6fef83422698aef7a981029e843e8161534`. Signatures were verified against the generated runtime-booted tool catalog at this revision.

The product ships 26 fixed tool packages covering 58 unique default names. No single agent receives the entire catalog: Host capabilities, the selected agent preset, scoped additions/restrictions, and presentation mode determine the effective set.

## Argument notation

```text
argument:type     required
argument?:type    optional
-                 no arguments
A | B             union
```

## 1. Standard preset

The `standard` preset is the normal full coding-agent surface. The tables below list its model-visible native tools.

### 1.1 Shell, files, and search

| Tool | Arguments | Purpose |
|---|---|---|
| `bash` | `command:string`, `description:string`, `timeoutMs?:number`, `workdir?:string`, `run_in_background?:boolean` | Run a one-shot Bash command on non-Windows systems |
| `pwsh` | `command:string`, `description:string`, `timeoutMs?:number`, `workdir?:string`, `run_in_background?:boolean` | Windows alternative to `bash`; only one platform shell mounts |
| `read` | `file_path:string`, `offset?:number`, `limit?:number` | Read a bounded text-file range |
| `read_image` | `file_path:string` | Load an image as a durable attachment for an image-capable route |
| `write` | `file_path:string`, `content:string` | Create or replace a file |
| `edit` | `file_path:string`, `old_string:string`, `new_string:string`, `replace_all?:boolean` | Replace literal text in a file |
| `glob` | `pattern:string`, `path?:string` | Find paths using a glob pattern |
| `grep` | `pattern:string`, `path?:string`, `include?:string` | Search file content; `include` filters filenames |

Examples:

```json
{
  "command": "pnpm run typecheck",
  "description": "Type-check the project",
  "workdir": "/workspace",
  "timeoutMs": 300000
}
```

```json
{
  "file_path": "src/index.ts",
  "old_string": "const enabled = false",
  "new_string": "const enabled = true"
}
```

```json
{
  "pattern": "registerTool",
  "path": "packages",
  "include": "*.ts"
}
```

### 1.2 Background jobs

| Tool | Arguments | Purpose |
|---|---|---|
| `job_list` | — | List background jobs owned by the agent |
| `job_output` | `job_id:string`, `wait?:boolean`, `timeout_ms?:number` | Read or wait for job output |
| `job_kill` | `job_id:string`, `reason?:string` | Stop a background job |

A producer enters the background-job system when it supports and receives `run_in_background: true`:

```json
{
  "command": "pnpm run dev",
  "description": "Start the development server",
  "run_in_background": true
}
```

The returned job id is passed to `job_output` or `job_kill`.

### 1.3 Skills

| Tool | Arguments | Purpose |
|---|---|---|
| `skill` | `name:string` | Load one skill's instructions by name |

```json
{
  "name": "systematic-debugging"
}
```

A skill is an instruction package, not a model-facing function. `skill` is the catalog/loader tool that retrieves it.

### 1.4 Goals and planning

| Tool | Arguments | Purpose |
|---|---|---|
| `create_goal` | `objective:string`, `max_goal_rounds?:number` | Create the current durable goal |
| `get_goal` | — | Read the current goal, state, revision, and usage |
| `update_goal` | `goal_id:string`, `revision:number`, `action:"edit" \| "pause" \| "resume" \| "complete" \| "blocked"`, `objective?:string`, `max_goal_rounds?:number`, `blocked_reason?:string` | Mutate the goal using optimistic revision control |
| `exit_plan_mode` | `plan:string` | Submit the complete plan for review |

```json
{
  "objective": "Upgrade authentication without breaking existing sessions",
  "max_goal_rounds": 12
}
```

```json
{
  "goal_id": "goal-123",
  "revision": 4,
  "action": "blocked",
  "blocked_reason": "The external identity provider is unavailable."
}
```

```json
{
  "plan": "# Authentication upgrade\n\n1. Update the provider adapter.\n2. Add migration coverage.\n3. Run the authentication E2E suite."
}
```

`exit_plan_mode` remains in the schema when plan mode is inactive to avoid changing the catalog across mode transitions. Execution outside plan mode is rejected.

### 1.5 Human interaction and todos

| Tool | Arguments | Purpose |
|---|---|---|
| `ask_user_question` | `questions:Question[]` | Ask structured questions and wait for human answers |
| `todo_write` | `todos:Todo[]` | Replace the current session's complete task list |

Nested shapes:

```ts
type Question = {
  id: string
  question: string
  header?: string
  options?: Array<{
    label: string
    description?: string
  }>
  multi_select?: boolean
}

type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}
```

```json
{
  "questions": [
    {
      "id": "database",
      "header": "Database",
      "question": "Which database should the deployment use?",
      "options": [
        {
          "label": "SQLite (Recommended)",
          "description": "Simplest single-host deployment."
        },
        {
          "label": "PostgreSQL",
          "description": "Better fit for concurrent multi-host access."
        }
      ]
    }
  ]
}
```

```json
{
  "todos": [
    {
      "content": "Inspect the implementation",
      "status": "completed"
    },
    {
      "content": "Implement the change",
      "status": "in_progress"
    },
    {
      "content": "Run focused tests",
      "status": "pending"
    }
  ]
}
```

`todo_write` replaces the entire list; it is not a partial-update operation.

### 1.6 Subagents and communication

| Tool | Arguments | Purpose |
|---|---|---|
| `subagent` | `description:string`, `prompt:string`, `run_in_background?:boolean` | Start a delegated child through the spawn provider |
| `subagent_fork` | `description:string`, `prompt:string`, `run_in_background?:boolean` | Start a child seeded from the parent's durable conversation history |
| `list_agents` | `scope?:"children" \| "descendants"` | List direct children or all descendants |
| `send_message` | `subagent_id:string`, `message:string` | Send input to a continuable child |
| `interrupt_agent` | `agent_id:string` | Interrupt a child agent |

```json
{
  "description": "Inspect persistence",
  "prompt": "Trace how SQLite session events are stored and report the important files.",
  "run_in_background": true
}
```

```json
{
  "subagent_id": "agent-123",
  "message": "Also check how schema migrations are versioned."
}
```

Optional `subagent_codex` and `subagent_claude_code` aliases use the same basic arguments. They appear only when the matching product-provider bundle is installed and the preset enables its tool row.

### 1.7 Workflows

| Tool | Arguments | Purpose |
|---|---|---|
| `workflow` | `script:string`, `meta:WorkflowMeta`, `args?:object` | Run a JavaScript orchestration program that coordinates subagents |
| `ralph` | `objective:string`, `maxRounds?:number` | Run a fixed iterative subagent workflow |

```ts
type WorkflowMeta = {
  name: string
  description: string
  whenToUse?: string
  phases?: Array<{
    title: string
    detail?: string
    provider?: string
    model?: string
  }>
}
```

```json
{
  "meta": {
    "name": "package-audit",
    "description": "Audit several package groups independently.",
    "phases": [
      {
        "title": "Inspect",
        "detail": "Read each package group."
      },
      {
        "title": "Synthesize",
        "detail": "Merge the findings."
      }
    ]
  },
  "args": {
    "groups": [
      "core",
      "session",
      "llm"
    ]
  },
  "script": "const reports = await pipeline(args.groups, async (group) => agent(`Audit packages/${group}`, { phase: 'Inspect' })); phase('Synthesize'); return reports.filter(Boolean);"
}
```

Workflow scripts receive these orchestration primitives:

```text
agent(prompt, options?)
pipeline(items, ...stages)
parallel(thunks)
phase(title)
log(message)
args
```

They do not receive filesystem, network, Node.js, or timer APIs. Subagents perform the actual work.

```json
{
  "objective": "Fix all reproducible TypeScript errors and verify after every round.",
  "maxRounds": 16
}
```

### 1.8 Web

| Tool | Arguments | Purpose |
|---|---|---|
| `web_search` | `queries:string[]` | Search through the configured Web provider |
| `web_fetch` | `url:string` | Fetch a specific page when enabled |

```json
{
  "queries": [
    "Node.js sqlite transaction documentation",
    "Cordis plugin lifecycle"
  ]
}
```

The standard preset sets `fetch: false`, so it normally exposes `web_search` but not `web_fetch`.

## 2. Code preset

The `code` preset retains approximately the same end capabilities as `standard`, but changes how the model accesses them.

| Tool | Arguments | Purpose |
|---|---|---|
| `run_code` | `code:string`, `description:string` | Run an async TypeScript function body with generated typed bindings for visible tools |

```json
{
  "description": "Search relevant files and read them concurrently",
  "code": "const files = await tools.glob({ pattern: '**/*.ts', path: 'packages/core' }); const contents = await Promise.all(files.slice(0, 3).map(file_path => tools.read({ file_path }))); return { files: files.slice(0, 3), contents };"
}
```

In strict Code Mode:

- `run_code` is the only directly callable model tool.
- End capabilities appear as generated `tools.<name>(args)` SDK bindings.
- Every binding call re-enters validation, policy, execution, and durable logging.
- Independent concurrency-safe calls may overlap.
- Side effects are not rolled back if a later binding fails.

In `both` mode, native schemas and `run_code` are both visible.

## 3. Minimal preset

The minimal preset exposes one platform shell and one combined editor.

| Tool | Arguments | Purpose |
|---|---|---|
| `bash` | `command:string` | Run a command in the persistent Bash PTY |
| `pwsh` | `command:string` | Windows alternative using a persistent PowerShell PTY |
| `str_replace_editor` | `command:"view" \| "create" \| "str_replace" \| "insert"`, `path:string`, `file_text?:string`, `insert_line?:integer`, `new_str?:string`, `old_str?:string`, `view_range?:integer[]` | View, create, replace, or insert file content |

`str_replace_editor` uses conditional arguments:

| Command | Required | Optional |
|---|---|---|
| `view` | `path` | `view_range:[start,end]` |
| `create` | `path`, `file_text` | — |
| `str_replace` | `path`, `old_str`, `new_str` | — |
| `insert` | `path`, `insert_line`, `new_str` | — |

```json
{
  "command": "view",
  "path": "/workspace/src/index.ts",
  "view_range": [
    20,
    80
  ]
}
```

```json
{
  "command": "str_replace",
  "path": "/workspace/src/index.ts",
  "old_str": "const port = 3000",
  "new_str": "const port = 8080"
}
```

## 4. Creator/Cordis preset additions

The Creator preset adds runtime inspection and dynamic plugin tools to a full coding-oriented surface.

| Tool | Arguments | Purpose |
|---|---|---|
| `cordis_inspect_list` | — | List inspectable runtime catalogs/providers |
| `cordis_inspect_query` | `platform:"host" \| "client"`, `provider:string`, `method:string`, `input?:unknown` | Query an inspection provider |
| `cordis_inspect_self` | `pluginId?:string`, `packageId?:string` | Inspect the current dynamic Cordis state |
| `cordis_define` | `plugin:PluginSelector`, `name:string`, `purpose:string`, `code:CordisCode` | Define an immutable dynamic Cordis package |
| `cordis_run` | `pluginId:string`, `packageId:string`, `mode:"run" \| "update"` | Run or update a defined package |
| `cordis_stop` | `pluginId:string` | Stop a running dynamic plugin |
| `cordis_undefine` | `pluginId:string` | Remove a dynamic plugin definition |

```ts
type PluginSelector =
  | {
      kind: 'new'
      idPrefix: string
    }
  | {
      kind: 'existing'
      pluginId: string
    }

type CordisCode = {
  host?: string
  client?: string
}
```

At least one of `code.host` or `code.client` must be present. Both are plain JavaScript function bodies, not TypeScript modules.

```json
{
  "plugin": {
    "kind": "new",
    "idPrefix": "hello"
  },
  "name": "Hello package",
  "purpose": "Register a temporary demonstration capability.",
  "code": {
    "host": "return { name: 'hello', apply(ctx) { ctx.logger.info('hello'); } }"
  }
}
```

These tools are privileged because model-written code reaches the live runtime. Keep them in a dedicated creator preset.

## 5. Opt-in capability tools

### 5.1 Persistent terminals

| Tool | Arguments | Purpose |
|---|---|---|
| `terminal_list` | — | List persistent terminal sessions |
| `terminal_open` | `type:string`, `name?:string`, `cwd?:string` | Open a persistent terminal |
| `terminal_read` | `sessionId:string`, `offset?:number`, `count?:number` | Read buffered terminal output |
| `terminal_send` | `sessionId:string`, `text:string`, `submit?:boolean`, `run_in_background?:boolean` | Send text or submit a command |
| `terminal_signal` | `sessionId:string`, `signal:"SIGINT" \| "SIGTERM" \| "SIGKILL" \| "SIGTSTP" \| "SIGHUP"` | Send a process signal |
| `terminal_close` | `sessionId:string` | Close a terminal |

```json
{
  "type": "bash",
  "name": "dev-server",
  "cwd": "/workspace"
}
```

```json
{
  "sessionId": "terminal-123",
  "text": "pnpm run dev",
  "submit": true,
  "run_in_background": true
}
```

### 5.2 Language Server Protocol

| Tool | Arguments | Purpose |
|---|---|---|
| `lsp` | `operation:"goToDefinition" \| "findReferences" \| "goToImplementation" \| "hover"`, `file_path:string`, `line:number`, `character:number` | Query the configured language server |

```json
{
  "operation": "findReferences",
  "file_path": "/workspace/src/index.ts",
  "line": 42,
  "character": 15
}
```

### 5.3 Schedules

| Tool | Arguments | Purpose |
|---|---|---|
| `schedule_create` | `prompt:string`, exactly one of `after_seconds?:number`, `every_seconds?:number`, or `at?:string \| ScheduleAt` | Create a delayed, absolute, or recurring session reminder |
| `schedule_list` | — | List the session's schedules |
| `schedule_delete` | `id:string` | Delete a schedule |

```ts
type ScheduleAt = {
  date: string
  time: string
  time_zone: string
}
```

```json
{
  "prompt": "Check whether the deployment completed.",
  "after_seconds": 600
}
```

```json
{
  "prompt": "Prepare the release report.",
  "at": {
    "date": "2026-08-21",
    "time": "09:00:00",
    "time_zone": "Asia/Shanghai"
  }
}
```

### 5.4 Session search and tracing

| Tool | Arguments |
|---|---|
| `session_event_read` | `session_id?:string`, `seq:integer`, `before?:integer`, `after?:integer` |
| `session_event_search` | `session_id?:string`, `query:string`, `seq_from?:integer`, `seq_to?:integer`, `time_from?:string`, `time_to?:string`, `event_types?:string[]`, `surfaces?:("current" \| "shadowed" \| "log-only")[]` |
| `session_event_trace` | `session_id?:string`, `seq:integer` |
| `session_search` | `query:string`, `session_ids?:string[]`, `created_at_from?:string`, `created_at_to?:string`, `parent_session_ids?:string[]`, `include_root_sessions?:boolean`, `availability?:("live" \| "persisted")[]`, `event_seq_from?:integer`, `event_seq_to?:integer`, `event_time_from?:string`, `event_time_to?:string`, `event_types?:string[]`, `event_surfaces?:("current" \| "shadowed" \| "log-only")[]` |
| `session_trace` | `session_id?:string` |

These tools are read-only but potentially broad in authority because they expose durable data from other sessions.

### 5.5 Child-only report

| Tool | Arguments | Visibility |
|---|---|---|
| `report` | `output:string` | Registered only inside a compatible continuable child agent |

```json
{
  "output": "The persistence writer batches events by session and commits through the shared coordinator."
}
```

### 5.6 Experimental Agent Teams

An Agent Teams composition replaces overlapping legacy child-control tools with these team-aware implementations.

| Tool | Arguments | Purpose |
|---|---|---|
| `spawn_teammate` | `name:string`, `description:string`, `prompt:string`, `context?:"fresh" \| "fork"` | Start a durable teammate |
| `list_agents` | — | List team members |
| `send_message` | `target:string`, `message:string` | Queue a message without necessarily waking the target |
| `followup_task` | `target:string`, `message:string` | Send a follow-up and wake an idle target |
| `interrupt_agent` | `target:string` | Interrupt a teammate |
| `wait_agent` | `timeout_ms?:integer` | Wait for team/mailbox progress |
| `team_task_create` | `subject:string`, `description:string`, `blocked_by?:string[]`, `write_scopes?:string[]` | Create a task-board item |
| `team_task_get` | `task_id:string` | Read one task |
| `team_task_list` | `status?:"pending" \| "in_progress" \| "completed"`, `owner?:string`, `ready?:boolean`, `cursor?:integer`, `limit?:integer` | Query the task board |
| `team_task_update` | `task_id:string`, `expected_revision:integer`, `action:"claim" \| "release" \| "edit" \| "set_dependencies" \| "complete" \| "reopen" \| "reassign" \| "delete"`, `subject?:string`, `description?:string`, `blocked_by?:string[]`, `write_scopes?:string[]`, `owner?:string` | Mutate a task with revision checking |

### 5.7 Dynamic MCP tools

An MCP server may contribute arbitrary model-facing names and schemas at runtime. Those tools cannot be listed statically because the connected server defines them.

MCP tools still enter `ctx.tools` and therefore share:

- Agent-scoped visibility.
- Native or Code Mode presentation.
- Argument validation.
- Execution guards and policy.
- Durable tool-call and tool-result logging.
- UI rendering and replay.

## 6. Tool organization

### 6.1 Effective tool-set composition

```text
installed Host capabilities
        +
selected agent preset
        +
agent-scoped additions and restrictions
        +
presentation mode: native | code | both
        =
effective model-facing tool surface
```

Do not equate the generated catalog with one agent's visible surface. The catalog lists fixed tool packages the product can compose; presets and scopes choose among them.

### 6.2 Capability ownership

Tools are Consumers of capability services:

```text
Capability definition
        |
        v
Host provider
        |
        v
Model-facing tool Consumer
        |
        v
ctx.tools registry
        |
        v
agent -> preset -> global visibility
        |
        v
native | code | both presentation
        |
        v
model request
```

Filesystem is the representative example:

```text
@deepseek-ai/dsh-fs
  defines ctx.fs

@deepseek-ai/dsh-fs-local
  implements ctx.fs on the local machine

@deepseek-ai/dsh-fs-sandbox
  exposes ctx.fs through sandbox policy

@deepseek-ai/dsh-tool-fs
  registers read, read_image, write, and edit

@deepseek-ai/dsh-tool-fs-search
  registers glob and grep
```

The tool packages depend on the filesystem definition rather than one provider. A deployment can switch from local to sandboxed execution without changing the model-facing schemas.

### 6.3 Registry layers and scopes

The Host owns one `ctx.tools` service. Registrations resolve by scope:

```text
agent-owned registrations
        |
        v shadows
preset registrations
        |
        v shadows
global Host registrations
```

Rules:

- A duplicate name within one layer fails.
- A nearer scoped registration can shadow an inherited name.
- Agent restrictions filter inherited tools.
- A child's own reporting/output tools survive filters over inherited capabilities.
- `run_code` is reserved and cannot be registered or shadowed.
- Disposing a registering Fiber removes the registration.

### 6.4 Tool definition anatomy

A first-party definition contains:

```text
name
description
parameter schema
canonical output schema
execute(args, context)
output renderer
optional presentation metadata
optional cooperative timeout declaration
optional concurrency classifier
optional pending/completed UI presenters
optional final content transformer
```

Only these fields are sent to the model in native mode:

```text
name
description
parameters
```

Successful execution returns a canonical lossless-JSON value. The output declaration validates that value and renders it into Native/model-facing content. This keeps Code Mode values, Native content, durable events, and replay presentation aligned.

### 6.5 Execution pipeline

```text
model-generated arguments
        |
        v
schema validation
        |
        v
tools/pre-execute waterfall
        |
        v
monotonic guards and approval/policy
        |
        v
tools/execute waterfall
        |
        v
tool body
        |
        v
tools/post-execute waterfall
        |
        v
final content normalization
        |
        v
durable tool/result
```

Native calls and Code Mode SDK sub-calls use this same pipeline. Failed or denied calls still produce durable error results so model history, replay, and UI state remain consistent.

### 6.6 Concurrency

Tools are exclusive by default. A definition must explicitly return `true` from `isConcurrencySafe(args)` to overlap with sibling calls.

The scheduler:

1. Starts calls in model order.
2. Runs consecutive safe calls through a bounded parallel pool.
3. Drains the pool before an exclusive call.
4. Runs the exclusive call alone as an ordering barrier.
5. Preserves durable results in model order.

Read-only work may opt in only when it does not mutate parent-owned state and shared dependencies tolerate overlap. Mutation tools should normally remain exclusive.

### 6.7 Recommended surface organization

Avoid an undifferentiated all-tools preset. Organize agent capabilities into explicit tiers.

#### Core coding

```text
read
write
edit
glob
grep
bash | pwsh
ask_user_question
todo_write
```

#### Work management

```text
create_goal
get_goal
update_goal
exit_plan_mode
job_list
job_output
job_kill
```

#### Delegation

```text
subagent
subagent_fork
list_agents
send_message
interrupt_agent
workflow
ralph
```

#### Research and introspection

```text
web_search
web_fetch
lsp
session_search
session_trace
session_event_*
skill
```

#### Long-running operations

```text
terminal_*
schedule_*
```

#### Privileged creator/operator tools

```text
cordis_*
MCP administrative tools
experimental Agent Teams
product-native subagents
```

Host bundles install capability providers. Tool packages translate those capabilities into stable model contracts. Presets decide which contracts an agent receives. Presentation mode decides how the model invokes them.

## 7. Source index

These sources are pinned to the document baseline.

- [Generated tool schema catalog](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/docs/tool-catalog.md)
- [Tool runtime and registry](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/tools/src/index.ts)
- [Typed tool-definition helper](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/tools/src/schema.ts)
- [Tool runtime documentation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/tools/README.md)
- [Agent tool presentation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/core/agent-tool-presentation/README.md)
- [Standard preset](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/config/agent-presets/standard/agent.cordis.yml)
- [Code preset](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/config/agent-presets/code/agent.cordis.yml)
- [Minimal preset](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/config/agent-presets/minimal/agent.cordis.yml)
- [Creator/Cordis preset](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/apps/cli/config/agent-presets/cordis/agent.cordis.yml)
