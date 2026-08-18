# Native DHS Workflow UI Specification

Status: Draft — functional vertical slice implemented; visual polish and durable phase/log projection remain follow-up work.

Target: C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\workflow-ui

## 1. Purpose

workflow-ui is a native DeepSeek Harness browser plugin for presenting workflow execution in the DHS web UI. It borrows Pi dynamic workflows' information architecture—run navigator, phases, agent tree, live progress, logs, and run detail—but uses DHS execution, Session events, Cordis composition, and React components.

It must not import Pi's workflow engine, model routing, TUI, persistence format, or harness abstractions.

## 2. Goals

- Provide a real workflow workspace in the DHS web UI.
- Keep the existing inline workflow-run Conversation Node working.
- Show live progress from durable Session events.
- Reconstruct the same state from historical events after reload.
- Display phases, agents, logs, status, errors, structured results, and child Sessions.
- Load as a normal Cordis plugin through the DHS dsh.client contract.
- Use DHS's existing default model/provider and workflow engine.
- Keep the first release simple and read-mostly.

## 3. Non-goals

The first release does not implement:

- a second workflow engine;
- a new model, provider, or harness layer;
- Pi model tiers or per-agent model routing;
- Pi's terminal UI;
- worktree isolation;
- pause/resume;
- journal replay;
- a new persistence format;
- token/cost accounting;
- saved workflows;
- nested workflows.

## 4. Native DHS boundaries

~~~
tool-workflow
  model-facing schema, workflow start, result, durable lifecycle recording

ctx.workflowEngine
  script execution, child agents, structured output, cancellation, disposal

workflow-ui
  browser event projection, dashboard state, React presentation, navigation

DHS client runtime
  Cordis client composition, slots, locale, Session navigation
~~~

The UI must not start another engine or infer state from raw model messages. It consumes typed durable events.

## 5. Workflow contract

The UI reflects the existing DHS workflow contract:

~~~ts
ctx.workflowEngine.start({
  script,
  meta,
  args,
  parent,
  signal,
})
~~~

The run exposes:

~~~ts
{
  id,
  meta,
  result,
  cancel(reason?),
  dispose(),
}
~~~

The script APIs are:

~~~ts
agent(prompt, { label?, phase?, schema? })
parallel(thunks)
pipeline(items, ...stages)
phase(title)
log(message)
args
~~~

The workflow UI does not expose model or provider selection. Structured child results are rendered as JSON when present.

## 6. Durable event contract

Current durable events:

~~~
tool-workflow/run-start
tool-workflow/agent-start
tool-workflow/agent-end
tool-workflow/run-end
~~~

The engine already emits:

~~~
workflow/start
workflow/phase
workflow/log
workflow/agent-start
workflow/agent-end
workflow/end
~~~

For the dashboard, dsh-tool-workflow must project phase and log events into Session history:

~~~
tool-workflow/phase
tool-workflow/log
~~~

Suggested payloads:

~~~ts
interface ToolWorkflowPhaseData {
  readonly runId: WorkflowRunId
  readonly title: string
}

interface ToolWorkflowLogData {
  readonly runId: WorkflowRunId
  readonly message: string
}
~~~

The existing run and agent payloads remain authoritative. Session sequence numbers provide ordering.

The event invariant must enforce:

- phase and log events reference an open run;
- phase and log events cannot appear after run-end;
- member starts and ends remain paired;
- a missing terminal suffix can be rendered as interrupted.

## 7. UI layout

### 7.1 Workflow workspace

The primary view is a substantial browser workspace, not only a status button or
debug card. It is opened from a shell-level `Workflows` launcher and renders as
a floating two-pane panel that remains readable while the underlying Session
conversation is visible.

The target information hierarchy is:

1. workspace header with title, active-run count, close action, and filters;
2. run navigator with one compact row per workflow;
3. selected-run header with name, status, current phase, and member progress;
4. phase sections containing the agent/member tree;
5. ordered live log feed;
6. structured result or error detail.

The target visual shape is:

~~~
+-------------------------------------------------------------+
| Workflows                         All  Running  Failed      |
+----------------------+--------------------------------------+
| Run list             | Selected run                        |
|                      |                                      |
| ● auth-audit         | auth-audit                 Running  |
|   Review · 4/8       | Review · 4/8 agents                 |
|                      |                                      |
| ✓ migration-check    | Phases                               |
|   Completed          | ✓ Scan                               |
|                      | ● Review                             |
| ✕ api-review         |   ├─ routes-1       Completed       |
|   Failed             |   ├─ routes-2       Running         |
|                      |   └─ routes-3       Failed          |
|                      |                                      |
|                      | Logs                                 |
|                      | Checking route authorization...      |
|                      |                                      |
|                      | Result                               |
|                      | { "missingAuth": 3 }                |
+----------------------+--------------------------------------+
~~~

The panel should have clear visual hierarchy rather than presenting all fields
as unstyled text. Run rows and member rows use compact status badges or dots;
running, completed, failed, cancelled, and interrupted states remain visually
distinct and accessible by text as well as color. The selected run is visibly
highlighted. The detail pane is divided into labelled sections (`Phases`,
`Logs`, and `Result`) with enough spacing for long workflow names, log lines,
errors, and JSON values.

While a run is active, the workspace must make progress legible at a glance:

- the launcher may include the active-run count;
- the selected run shows `Running` and a member count such as `4/8`;
- the current phase is marked as active;
- member rows update as children start and finish;
- new log messages append in sequence without replacing prior messages.

The workspace also defines stable non-running states:

- loading: preserve the panel shell while the current Session projection loads;
- empty: explain that the current Session has no workflow runs and keep the
  launcher/panel controls usable;
- completed: keep phases, members, logs, and structured results inspectable;
- failed/cancelled/interrupted: surface the terminal state and error or
  interruption detail without hiding already-collected progress.

Run list fields:

- workflow name;
- status;
- current phase;
- member counts;
- failure or interruption indicator.

Run detail fields:

- name and status;
- phase sections;
- agent/member tree;
- member status;
- live logs;
- structured result;
- error details;
- links to child Sessions.

Elapsed time, token usage, model, and cost are deferred until they have a stable DHS event contract.

Presentation constraints:

- the workspace is read-mostly and must not expose model/provider selection;
- the workspace must remain useful at narrow browser widths by allowing the
  run navigator to scroll or collapse without losing selected-run detail;
- the visual treatment is native DHS browser UI, not a Pi terminal/TUI clone;
- the inline Conversation Node remains a compact in-conversation summary,
  while this workspace is the richer inspection surface.

### 7.2 Inline Conversation Node

The existing inline workflow-run node remains supported:

~~~
workflow: auth-audit
Review · 4/8 agents · Running

▼ Review
  ✓ routes-1     Completed
  ● routes-2     Running
  ✕ routes-3     Failed
~~~

The workspace and inline node must consume the same projected state.

### 7.3 Child Sessions

Clicking a member with a valid child Session opens that Session through DHS Session navigation. The plugin does not recreate child conversation rendering.

### 7.4 Functional baseline versus target polish

The smallest production vertical slice may initially provide the shell overlay,
two-pane layout, run list, selected-run detail, status/phase/member rendering,
structured results, and child-session navigation with minimal CSS. That baseline
is useful for integration verification but is not the final visual target. A
follow-up polish pass must implement the hierarchy, status treatment, section
layout, responsive behavior, and running-state presentation described above.

## 8. Client implementation

Follow the existing ui-workflow-run browser plugin pattern:

~~~ts
export const inject = [
  'conversationEvents',
  'slots',
  'sessions',
  'locale',
]

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(workflowDashboardDefinition)
  ctx.locale.register(namespace, { zh, en })
  ctx.slots.inject(designatedWorkflowWorkspaceSlot, () =>
    ctx.slots.register(dashboardRegistration, WorkflowDashboard))
}
~~~

The state definition uses the standard Conversation Node lifecycle:

~~~ts
match(event)
start(context, match)
update(context, match)
buildViewNode(context)
~~~

The exact top-level workspace slot is a web-shell integration detail. It must be selected from the active DHS slot map. The plugin must not use DOM selectors or mutate the shell directly.

## 9. Package structure

~~~
workflow-ui/
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── README.md
├── SPEC.md
├── src/
│   ├── index.ts
│   ├── invariant.ts
│   └── client/
│       ├── index.ts
│       ├── workflow-dashboard-definition.ts
│       ├── WorkflowDashboard.tsx
│       ├── WorkflowRunList.tsx
│       ├── WorkflowRunDetail.tsx
│       ├── WorkflowAgentTree.tsx
│       ├── WorkflowLog.tsx
│       ├── locales.ts
│       └── WorkflowDashboard.module.css
└── tests/
    ├── workflow-events.test.ts
    ├── workflow-dashboard.client.spec.tsx
    └── workflow-ui.integration.test.ts
~~~

src/index.ts is the Cordis host package entrypoint. For the first UI-only release it may be a no-op apply function. The browser contribution lives in src/client/index.ts and is discovered through exports["./client"].

## 10. Cordis package contract

The package must expose a browser bundle and declare its browser dependencies:

~~~json
{
  "name": "workflow-ui",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./invariant": {
      "types": "./lib/types/invariant.d.ts",
      "default": "./lib/invariant.js"
    }
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-workflow-run"
      ]
    }
  }
}
~~~

The active DHS profile installs the package as a dependency and includes it as a normal Cordis loader entry. The DHS client module system then discovers dsh.client, serves the client bundle, and includes it in the browser boot graph.

## 11. Cross-session boundary

The first release may reconstruct runs from the current parent Session. A dashboard spanning all Sessions requires a host-side workflow index because the browser Conversation event stream is not a global registry.

A later host service may expose:

~~~ts
listRuns()
getRun(runId)
stopRun(runId)
~~~

It must reuse existing WorkflowRun handles and Session records. It must not create a second persistence format or duplicate execution state.

## 12. Controls

Initial release:

- open child Session;
- inspect logs and result;
- display completed, failed, cancelled, and interrupted states.

Optional first control:

~~~
stop(runId)
~~~

Stop requires a host-side run registry because the current WorkflowRun handle is holder-owned by tool execution. Pause/resume is deferred.

## 13. Testing

### Event projection

- reconstruct a completed run from cold Session history;
- apply live run-start, phase, log, agent, and run-end events;
- preserve event ordering;
- reject invalid event sequences;
- infer interrupted state when the terminal event is absent;
- preserve member pairing.

### UI behavior

- render an empty run;
- render phases and members;
- render running, completed, failed, cancelled, and interrupted states;
- render logs in order;
- render structured JSON results;
- open child Sessions;
- keep inline workflow-run rendering unchanged.

### Cordis integration

- browser apply waits for declared injections;
- definitions and slots register exactly once;
- locale registration disposes correctly;
- package exposes a valid ./client bundle;
- client module discovery includes the package in the boot graph;
- build and typecheck pass on Windows.

### Browser E2E

1. Start a workflow and observe live phase/member updates.
2. Reload and reconstruct the historical run.
3. Open a child Session from the agent tree.
4. Verify failed and cancelled runs.
5. Verify normal chat and tool rendering are unchanged.

## 14. Implementation sequence

1. Add tool-workflow/phase and tool-workflow/log durable types, recorder support, and invariants.
2. Extend the existing workflow Conversation Node state projection.
3. Scaffold the Cordis-compatible workflow-ui package.
4. Implement the run list and selected-run detail layout.
5. Register the browser plugin through dsh.client and the client module system.
6. Add event, renderer, and browser integration tests.
7. Add a host-side run index and stop control only after the read-only dashboard is stable.

## 15. Acceptance criteria

- workflow-ui loads as a normal Cordis plugin;
- no second workflow engine or model layer exists;
- the dashboard is driven by DHS durable events;
- live and historical state render identically;
- phases, agents, logs, results, and errors are visible;
- child Session navigation uses DHS services;
- existing inline workflow UI remains compatible;
- the package builds and browser E2E tests pass;
- no Pi-specific runtime or model configuration is required.
