# claude-code-loop

Status: implementation specification

`claude-code-loop` adds session-scoped recurring prompt delivery to DeepSeek
Harness (DSH) as an external Cordis plugin. It must not modify the
`deepseek-harness` source tree.

## 1. Goals and non-goals

Required:

1. Create recurring prompts for the current session.
2. Use seconds as the only time unit.
3. Use `steer()` for a running agent when `allow_steer` is true.
4. Use a normal follow-up when steering is not appropriate.
5. Persist loop state as session events and reconstruct it on resume.
6. Keep loops isolated to their owning session.
7. Expose current loop state to the UI without browser-side event replay.
8. Show a small indicator for the selected conversation.
9. Give every loop a human-readable title for GUI management.
10. Allow session-scoped create, update, and delete operations.
11. Pass deterministic preflight tests before any real-agent test.
12. Keep every source change inside this plugin directory.

Not in this version:

- changes to DSH core or the DSH web application;
- a global scheduler or separate database;
- `loop_pause`, `loop_resume`, or `loop_run_now`;
- a promise that timers survive host-process termination.

Durable events allow a resumed session to reconstruct state; timer handles are
process-local.

## 2. Session model

A loop belongs to the current agent session. The model does not pass a
`session_id` to any loop tool; DSH invokes the tool inside the current session
scope.

```text
session A -> loop_abc
session B -> cannot list, deliver, or delete loop_abc
```

The loop prompt is delivered as a normal plugin-sourced user message. A
successful dispatch means that the message was admitted to the agent inbox;
it does not mean that the model completed the resulting turn.

## 3. Public tools

The plugin exposes four model-visible tools. The GUI uses the same session
command/tool path, so model and browser mutations share validation,
persistence, and scheduling behavior.

### `loop_create`

```ts
loop_create({
  title?: string,
  prompt: string,
  time_in_seconds: number,
  allow_steer?: boolean,
}) -> LoopView
```

Rules:

- `title`, when supplied, is trimmed and non-empty;
- `prompt` is required and non-empty after trimming;
- `time_in_seconds` is a positive safe integer;
- seconds are the only time unit;
- `allow_steer` defaults to `true` and the default is persisted explicitly;
- the first delivery is scheduled at `now + time_in_seconds`;
- the plugin generates the session-local loop ID.

The GUI requires a title. The existing `/loop <seconds> <prompt>` syntax keeps
working without a title; the host derives a compact title from the first
non-empty prompt line for that path.

### `loop_list`

```ts
loop_list() -> LoopView[]
```

Returns active loops for the current session. An empty array is normal.

### `loop_update`

```ts
loop_update({
  id: string,
  title?: string,
  prompt?: string,
  time_in_seconds?: number,
  allow_steer?: boolean,
}) -> LoopView
```

Rules:

- `id` must name an active loop in the current session;
- at least one mutable field must be supplied;
- supplied `title` and `prompt` values are trimmed and non-empty;
- supplied `time_in_seconds` is a positive safe integer;
- supplied `allow_steer` is boolean;
- changing only title, prompt, or delivery mode preserves `next_at`;
- changing the interval sets `next_at` to `now + time_in_seconds`;
- the complete post-update record is persisted before success is returned.

### `loop_delete`

```ts
loop_delete({ id: string }) -> { deleted: true, id: string }
```

The ID must be non-empty and must belong to the current session. Unknown and
cross-session IDs are input errors.

### `LoopView`

```ts
interface LoopView {
  id: string
  title: string
  prompt: string
  time_in_seconds: number
  allow_steer: boolean
  next_at: number
  state: 'scheduled' | 'overdue'
  delivery_mode: 'session-local'
}
```

Invalid input must fail before an event is written. Persistence and delivery
failures must not be returned as successful tool results.

## 4. Delivery semantics

At the due time, the runtime creates a normal user message containing the loop
prompt:

```text
allow_steer === true && agent.status === running
    -> agent.steer(message)
otherwise
    -> agent.followup(message)
```

`steer()` is next-step input. It does not interrupt an in-flight model request
or tool call. An idle agent deliberately receives a follow-up, even when
steering is allowed, so an independent scheduled iteration does not become a
second step in an idle turn.

After dispatch, advance `next_at` by whole intervals until it is in the
future. Do not replay every missed tick after a long delay; one admitted
prompt catches the session up without generating a burst.

Drive operations must be serialized per session so a timer callback and a
manual state operation cannot dispatch the same loop twice.

## 5. Persistence and lifecycle

The plugin owns the `loop/change` event family:

```ts
type LoopChange =
  | { version: 1; operation: 'create'; loop: LoopRecord }
  | { version: 1; operation: 'update'; loop: LoopRecord }
  | { version: 1; operation: 'delete'; id: string }
  | { version: 1; operation: 'dispatch'; id: string; next_at: number }

interface LoopRecord {
  id: string
  title: string
  prompt: string
  time_in_seconds: number
  allow_steer: boolean
  next_at: number
}
```

The event log is the source of truth. Timer handles, runtime maps, in-flight
promises, and cached folded state are process-local.

Create, update, delete, and dispatch must flush the session before reporting
success.
On resume, fold the event suffix and recreate timers for active records. Apply
the missed-tick policy from Section 4 on the first resumed drive.

The plugin installs one runtime and four agent-scoped tools for each root
agent. `agent.ctx.effect()` owns runtime/timer/tool cleanup. Plugin disposal
stops accepting new agents and awaits all existing runtime disposers.

## 6. UI contract

The UI is in `src/ui/`, but DSH still discovers it through the package's public
client-plugin metadata.

The host half exposes a session projection named:

```text
claude-code-loop
```

```ts
interface LoopProjection {
  loops: Array<{
    id: string
    title: string
    prompt_preview: string
    time_in_seconds: number
    next_at: number
    allow_steer: boolean
    state: 'scheduled' | 'overdue'
  }>
}
```

The projection is current state for the UI, not a model-visible tool. The host
updates it after create, update, delete, dispatch, and resume folding. The UI
must not own a scheduler or replay raw `loop/change` events.

Inject a session-scoped GUI page into `conversation.view` beside Chat and
Trajectory, plus an optional compact navigation summary into
`conversation.input.dock`:

```text
page:             Loops tab with cards and New/Edit/Delete controls
empty page:       No recurring loops yet + New loop
summary:          ↻ 3 active loops · next in 8s [Open loops]
no active loops:   summary renders nothing
```

The GUI form edits title, prompt, interval, and delivery mode. Delete requires
confirmation. Mutations use the existing DSH session command channel and wait
for the projection to reflect success; the browser never writes events or
calls Agent delivery methods. The selected conversation already establishes
the owning session, so the UI must not repeat a session ID in every loop row.
No Pause/Resume/Run Now buttons are part of this version.

Projection registration must use a public DSH plugin API. If the installed
DSH version does not expose external projection registration, stop at
preflight and document that limitation; do not patch DSH core or make the
browser infer state from incomplete event history.

## 7. Source layout

Use the smallest structure consistent with `dsh-codex-shell`:

```text
claude-code-loop/
├── README.md
├── SPEC.md
├── cordis.patch.yml
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   │   └── host lifecycle and registration
│   ├── loop.ts
│   │   └── runtime, folding, scheduling, and projection snapshot
│   ├── tools.ts
│   │   └── loop_create, loop_list, loop_update, loop_delete
│   ├── types.ts
│   │   └── shared loop/event/projection types
│   └── ui/
│       ├── index.ts
│       │   └── browser plugin entry and slot injection
│       ├── LoopIndicator.tsx
│       │   └── current-session indicator and details
│       └── LoopIndicator.module.css
│           └── minimal styles
└── test/
    ├── loop.test.ts
    ├── tools.test.ts
    ├── delivery.test.ts
    ├── persistence.test.ts
    ├── plugin-entrypoint.integration.test.ts
    ├── ui.test.tsx
    └── support/
        └── fake-agent.ts
```

There is deliberately no separate `projection.ts` in v1. Projection behavior
belongs with the loop runtime in `loop.ts` until it is large enough to justify
another module.

`lib/` and `node_modules/` are generated/dependency directories and must not
be hand-edited.

## 8. Package/plugin integration

The host entry remains a normal external Cordis plugin:

```ts
export const name = 'claude-code-loop'
export const inject = ['tools', 'agents', 'sessions', 'sessionPersistence']

export function apply(ctx: Context): void {
  // register agent-scoped runtimes and tools
}
```

The host entry must not import React or browser globals. The UI source lives
under `src/ui/`, but the package-facing export remains `./client` to follow
DSH's existing client-plugin convention. The directory name and the loader
entry name do not need to be identical.

Conceptually:

```json
{
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/ui/index.d.ts",
      "default": "./lib/ui.js"
    }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  }
}
```

Exact generated filenames may follow the chosen TypeScript bundling setup;
the contract is separate host/UI entry points and public DSH discovery.

`cordis.patch.yml` may register the compiled absolute plugin path. It must not
patch or copy files into `deepseek-harness`.

## 9. Implementation order

1. Keep domain types, validation, event folding, and `LoopView` conversion
   independent of real timers and model providers.
2. Implement one runtime per root agent/session, with a fake-clock seam for
   tests.
3. Register and test the four tools against a real tool/session boundary with
   a mocked Agent/model.
4. Register the `claude-code-loop` session projection through the public DSH
   plugin API.
5. Add the GUI page, shared create/edit form, and summary indicator after the
   projection contract is deterministic.
6. Build host and UI entries and verify package exports.

## 10. Test framework and behavior coverage

Copy the actual conventions from `dsh-plugins/codex-shell`:

- strict TypeScript, native ESM, explicit `.js` imports;
- `tsc` for build/typecheck;
- Vitest with `test/**/*.test.ts` discovery;
- domain-oriented test directories when a subsystem grows;
- `afterEach` cleanup;
- explicit plugin-entrypoint integration tests;
- fake support objects instead of provider-backed agents for unit tests.

`codex-shell` has no coverage provider, `test:coverage` script, reporter, or
threshold. Therefore v1 uses the following required behavioral coverage
matrix instead of claiming a numeric percentage.

Tool contract:

- valid create;
- optional and explicit title behavior;
- default and explicit `allow_steer`;
- blank prompt and invalid interval rejection;
- empty and populated list;
- current-session delete;
- unknown and cross-session delete;
- current-session update for title, prompt, interval, and delivery mode;
- unknown and cross-session update;
- required result shape.

Scheduling:

- running + steer allowed -> exactly one `steer`;
- idle + steer allowed -> exactly one follow-up;
- steer disabled -> exactly one follow-up;
- `next_at` advances;
- missed intervals do not burst;
- concurrent drives do not duplicate dispatch;
- delivery failure does not report false success.

Persistence/lifecycle:

- state-changing operations flush before success;
- create/delete/dispatch folding;
- resume reconstructs active loops;
- agent and plugin disposal remove timers and tools;
- sessions remain isolated.

UI:

- title, prompt, interval, and delivery controls are rendered;
- create validates and submits a session command;
- edit is prefilled and submits the changed settings;
- delete requires confirmation and removes the projected card;
- errors and pending states keep the user in context;
- changing sessions changes the visible projection;
- UI disposal removes slot registration.

Numeric coverage may be added later with a separate V8 provider and
`test:coverage` script. It is not a prerequisite for v1.

## 11. Preflight before real agents

The real-agent smoke test is the final step. Run all checks from the plugin
directory:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

If Corepack rejects the pinned pnpm signature, use the provisioned fallback
pnpm binary and record its version; do not silently change the package manager
pin.

Then import the compiled host entry without starting an agent:

```bash
node --input-type=module -e \
  "import('./lib/index.js').then(m => { \
    if (m.name !== 'claude-code-loop' || typeof m.apply !== 'function') \
      process.exit(1) \
  })"
```

The fake-agent preflight must:

1. register all four tools;
2. create a titled two-second loop;
3. list it;
4. advance a fake clock past `next_at`;
5. assert exactly one steer/follow-up according to status and policy;
6. assert `next_at` advanced;
7. update its title or interval and verify the new view;
8. delete it;
9. assert the list is empty;
10. dispose the runtime and assert no timer remains.

The isolation preflight must prove:

```text
session A: create loop A
session B: list -> []
session B: delete loop A -> error
session A: list -> [loop A]
```

The UI preflight feeds fixture projections and a mocked command channel
directly to the components. It does not start a DSH web server or model
provider.

Before and after all tests, compare the DSH core worktree against a recorded
baseline. Any new or modified file under:

```text
/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness/
```

blocks the change until investigated. Do not reset unrelated pre-existing
user changes.

## 12. Manual agent smoke test

Only after preflight passes, use a disposable DSH profile and fresh session:

1. Load the compiled plugin from its absolute external path.
2. Ask the agent to create a two-second loop with a unique marker such as
   `LOOP_SMOKE_OK`.
3. Confirm `loop_list` returns the loop.
4. Wait for one delivery and confirm the marker appears in the same session.
5. Confirm the UI indicator is visible in that session.
6. Switch to another session and confirm the indicator is absent.
7. Return, delete the loop, and confirm the indicator disappears.
8. Confirm no additional delivery occurs.
9. Dispose the disposable profile and verify cleanup.

Record the plugin path/version, session ID, loop ID, tool results, delivery
mode, UI states, and cleanup result.

## 13. Definition of done

The implementation is complete only when:

1. the four tool contracts are exact, including title behavior;
2. seconds are the only time unit;
3. `allow_steer` defaults to true;
4. session isolation and resume tests pass;
5. fake-agent preflight passes without a model;
6. compiled host and UI entries load correctly;
7. the UI reads the named session projection, owns no scheduler, and supports
   create/edit/delete through the session command channel;
8. the manual disposable-profile smoke test passes; and
9. no `deepseek-harness` source file was changed.
