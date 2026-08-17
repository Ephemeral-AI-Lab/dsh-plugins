# loop implementation specification

Status: backend v1 implemented; inline-dock UI migration specified in
[`ui.md`](./ui.md) and still pending.

This document is the backend contract and implementation plan for the
`loop` DeepSeek Harness (DSH) plugin. The plugin is external to
DSH and must not modify
`/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness`.

`ui.md` is the current UI source of truth. The final UI is an inline loop dock
above the composer, not a separate Loops page. The current page implementation
is a known migration gap described in Section 9.

## 1. Product boundary

The plugin schedules a prompt for the current DSH session and delivers each
due occurrence to that session's normal agent inbox.

The v1 public surface is deliberately small:

- create a recurring prompt with a positive interval in seconds;
- list active loops for the current session;
- delete an active loop by ID;
- deliver each occurrence as a <heartbeat> user message;
- expose durable loop state through the loop session projection;
- provide the /loop command surface.

The plugin does not own a model, a second inbox, a global scheduler, a
database, or a browser-side event log. DSH owns agent execution and wakeup.
The session event log owns durable loop state. The timer is only a disposable
process-local wakeup mechanism.

### 1.1 Non-goals for v1

- changing DSH core or the DSH web application;
- a separate Loops route, page, tab, or sidebar collection;
- loop titles;
- loop_update, edit, pause, resume, or run-now operations;
- a steer/follow-up mode selector;
- direct calls to Agent.steer() or Agent.followup();
- exact delivery while the host process is stopped or the operating system is
  asleep;
- replaying every interval missed while the process was unavailable;
- a provider-backed model test for scheduler correctness.

To change an interval or prompt in v1, delete the loop and create a new one.

## 2. Ownership and lifecycle

A loop is owned by the session in which its tool or command is executed. The
caller does not supply a session_id; DSH supplies the current session through
the agent boundary.

~~~text
session A ── owns ── loop_abc
session B ── cannot list, deliver, or delete loop_abc
~~~

There is one LoopRuntime for each exact root agent. The runtime is attached to
the agent's Cordis effect and is disposed with that agent. Plugin disposal
stops new runtime creation and awaits existing runtime cleanup.

The runtime verifies that its exact agent is still registered before doing
work. If DSH replaces the agent for the same session, the old runtime becomes
inert and the replacement agent reconstructs its timer from the session log.

The browser does not create a scheduler. It reads the current session
projection and sends mutations through the existing session command path.

## 3. Public contract

### 3.1 Tools

The plugin registers these agent-local tools:

~~~ts
loop_create({
  prompt: string,
  time_in_seconds: number,
}) -> LoopView

loop_list({}) -> LoopView[]

loop_delete({
  id: string,
}) -> { deleted: true, id: string }
~~~

loop_list accepts an empty object because it is a DSH tool call. The command
surface and UI use the same registered tools rather than duplicating
validation or persistence.

Create validation:

- prompt must be a string with non-whitespace content;
- the stored prompt is trimmed;
- time_in_seconds must be a positive safe integer;
- seconds are the only supported time unit;
- the first next_at is Date.now() + time_in_seconds * 1000;
- the plugin generates a session-local ID such as loop_<uuid>.

Delete validation:

- id must be a non-empty string;
- the ID must be active in the current session;
- an unknown or cross-session ID is an input error;
- invalid input is rejected before a session event is appended.

State-changing tool calls flush session persistence before returning success.
Persistence failures are errors, never successful tool results.

### 3.2 Command surface

The command parser accepts exactly:

~~~text
/loop <seconds> <prompt>
/loop list
/loop delete <id>
~~~

Examples:

~~~text
/loop 1 Check whether the build is still healthy
/loop 30 Summarize any new failures
/loop list
/loop delete loop_a91
~~~

The command delegates to rootCtx.tools.execute() with the current agent.
That keeps command behavior identical to model-tool behavior, including
session ownership, validation, event persistence, and timer arming.

Malformed input returns:

~~~text
Usage: /loop <seconds> <prompt> | /loop list | /loop delete <id>
~~~

### 3.3 Shared data types

~~~ts
interface LoopRecord {
  id: string
  prompt: string
  time_in_seconds: number
  next_at: number       // Unix epoch milliseconds
}

interface LoopView extends LoopRecord {
  state: 'scheduled' | 'overdue'
  delivery_mode: 'session-local'
}

interface LoopProjection {
  loops: LoopRecord[]
}
~~~

state is derived at read time from next_at <= Date.now(). It is not persisted.
delivery_mode describes ownership, not a user-selectable routing option.

The durable event family is loop/change:

~~~ts
type LoopChange =
  | { version: 1; operation: 'create'; loop: LoopRecord }
  | { version: 1; operation: 'delete'; id: string }
  | { version: 1; operation: 'dispatch'; id: string; next_at: number }
~~~

The current reducer also accepts the previous build's operation: update
records and strips its removed title and allow_steer fields. This is read
compatibility only. It is not a v1 public operation and new code must not
emit it.

## 4. Message contract

Every admitted loop occurrence is a normal DSH user message created with the
plugin source:

~~~xml
<heartbeat>
  <loop_id>loop_a91</loop_id>
  <prompt>Check whether the build is still healthy</prompt>
</heartbeat>
~~~

The loop_id and prompt values are XML-escaped. The complete message is
created with DSH's createUserMessage() and sent with the public Agent.send()
API:

~~~ts
agent.send(message, target, true)
~~~

The third argument is wakeup: true. This asks the live DSH agent driver to wake
and process the inbox message. The plugin does not call steer() or followup();
it calls the underlying inbox API directly because the target is adaptive.

## 5. Adaptive delivery

Adaptive delivery chooses the inbox target at the instant the loop is due:

~~~ts
const target = agent.status === 'running' ? 'next-step' : 'next-turn'
agent.send(message, target, true)
~~~

| Agent status when due | Inbox target | Meaning |
| --- | --- | --- |
| idle | next-turn | Queue a normal next user turn and wake the idle live agent. |
| running | next-step | Queue the prompt for the earliest safe step boundary and wake the running driver. |

This is adaptive routing, not an interrupt mechanism.

When the agent is running a model request or tool call, next-step does not
cancel or preempt that operation. DSH consumes the pending message at the
next supported agent-loop boundary. It avoids waiting for the entire turn
when DSH has an earlier step boundary, while preserving the current operation.

When the agent is idle, next-turn is the normal inbox queue and wakeup: true
lets the live DSH driver start the next turn. The UI does not need to know or
choose this distinction.

When the host process is stopped, there is no runtime or timer available to
call Agent.send(). When the operating system suspends the process, the timer
may fire late after resume. The next drive applies the missed-occurrence
policy in Section 7; exact wall-clock delivery during suspension is not
promised.

## 6. TypeScript and timer dependency choice

No scheduling library is used. This is intentional.

The implementation uses:

- TypeScript ES2024 standard library types from the project target;
- Node.js timer globals typed through @types/node;
- native Node setTimeout and clearTimeout;
- ReturnType<typeof setTimeout> for the timer handle;
- DSH's public Agent.send() for actual inbox delivery;
- DSH's createUserMessage() for the user-message envelope;
- zod only for projection shape validation.

There is no node-cron, cron, setInterval scheduler, queue package, or external
worker. A recurring loop is repeated one-shot timeouts. The package's only
runtime dependency is currently zod; adding a timer package would not improve
durability because the session event log and DSH inbox are the authoritative
boundaries.

The relevant compiler/runtime setup is:

~~~text
target: ES2024
module: NodeNext
types: ["node"]
runtime: Node.js
timer: setTimeout / clearTimeout
~~~

The browser countdown uses a separate local setInterval only for repainting
visible text. It never sends a message, mutates next_at, or touches the
backend scheduler.

## 7. Timer and drive algorithm

### 7.1 One-shot timer

The runtime stores one timer handle for the earliest active next_at.

~~~text
active session events
        │ fold
        ▼
active loops ── choose minimum next_at ── setTimeout(remaining delay)
                                                   │
                                                   ▼
                                           requestDrive()
~~~

The timer callback does not send a message directly. It clears its handle and
requests a serialized drive. This keeps timer callbacks small and means all
session reads, sends, and event appends use one ordered path.

Node timers use a signed 32-bit millisecond delay. The implementation clamps
each arm to:

~~~ts
const MAX_TIMER_DELAY_MS = 2_147_483_647
~~~

If a loop is farther away than this limit, the runtime wakes at the maximum
safe delay and re-arms the remainder. This avoids overflow and the common
Node behavior where an oversized delay becomes an immediate timeout.

### 7.2 Drive steps

start() requests the first drive. Every create, delete, and timer callback
also requests a drive.

One drive performs this sequence:

1. Stop if the exact agent is no longer live.
2. Flush pending session persistence so the runtime reads the durable suffix.
3. Fold loop/change events after the session seed boundary.
4. Find the active loop with the earliest next_at <= Date.now().
5. If no loop is due, arm the earliest future next_at and finish.
6. Create the escaped <heartbeat> user message.
7. Select next-turn or next-step from the current agent.status.
8. Call agent.send(message, target, true).
9. Append loop/change dispatch with the next future occurrence.
10. Flush persistence.
11. Request another drive in case another loop is due.

Due loops are ordered by next_at; ties preserve the stable active-record order
produced by the event fold. A single drive processes one due loop and then
re-drives, which keeps each dispatch and persistence boundary small.

### 7.3 Missed intervals

After a successful dispatch, next_at advances by whole intervals until it is
strictly in the future:

~~~ts
skipped = floor((now - oldNextAt) / intervalMs) + 1
newNextAt = oldNextAt + skipped * intervalMs
~~~

If a one-second loop is delayed by five seconds, it produces one heartbeat
and schedules the next occurrence in the future. It does not emit five
back-to-back heartbeats. This is the v1 anti-burst policy.

### 7.4 Serialization and coalescing

The runtime has one promise queue and one active drive promise per agent.
Multiple timer/manual requests are coalesced into a requested flag while a
drive is running. This prevents a create plus timer race from dispatching the
same durable loop twice.

transact() uses the same queue for tool operations. A create or delete is
therefore ordered with a drive and cannot partially race the fold used for
dispatch.

Disposal marks the runtime stopping, clears the timer, stops new requests,
and waits for the queue. A late timer callback cannot revive it.

### 7.5 Reliability boundary

The durable source of truth is the session log, not the timer handle. On
resume, the plugin folds the session log and creates a new one-shot timer.

The normal successful path is:

~~~text
timer fires
  → fold durable loop state
  → Agent.send(..., wakeup: true)
  → append dispatch with future next_at
  → flush session
~~~

If the initial persistence flush fails, the runtime does not send. If the
post-dispatch flush fails, the drive reports failure and the durable dispatch
advance is not considered complete; the session remains eligible for retry
after a later drive or resume. This is the deliberate v1 boundary: durable
state is never falsely advanced on a failed flush.

The timer gives best-effort wakeup; DSH's inbox is the actual delivery
boundary. The contract guarantees wake-enabled admission under normal live
process conditions, not an OS-level exactly-once scheduler.

## 8. Persistence and projection

The plugin registers loop/change with the host event catalog at plugin load and
registers the loop session projection through the public
session-projection API.

The reducer applies create, update-compatibility, delete, and dispatch events.
Projection state contains only the current active records:

~~~text
session events → fold/reducer → { loops: LoopRecord[] }
                                      │
                                      ▼
                         useProjection('loop')
~~~

The projection does not contain countdown strings, overdue booleans, timer
handles, agent status, or inbox state. The UI derives display text from
next_at and local Date.now().

Each session is projected independently. The browser must never infer loop
state by replaying raw event history or by reading another session's events.

## 9. UI contract from ui.md

The current UI decision is an inline loop dock in the selected session's
existing conversation.input.dock.

There is no separate Loops page, route, tab, sidebar collection, or TUI-style
monitor. The dock is additive and must preserve DSH's existing goal bar,
queued-message/steer/follow-up controls, composer, and keyboard shortcuts.

### 9.1 Display thresholds

| Active loops | Display |
| --- | --- |
| 0 | Render nothing; reserve no vertical space. |
| 1 | Render one loop row. |
| 2 | Render both loop rows. |
| 3+ | Render one collapsed summary row initially. |

For three or more loops, the summary expands in the same dock. Expand/collapse
uses a real accessible button; Escape and outside click collapse it.

Collapsed summary:

~~~text
↻ 4 active loops · next in 1s                         Expand ▾
~~~

Expanded rows contain only:

~~~text
↻ every 1s   next in 8s   Check whether the build is healthy       Delete
~~~

The normal row does not show a session ID, title, or loop ID. It shows the
interval, countdown or overdue, one-line truncated prompt, and an accessible
Delete action.

### 9.2 UI actions and ownership

The UI has no pause/resume, run-now, edit/update, steer/follow-up selector,
session-ID display, or delivery-mode control. To change a loop, delete and
recreate it.

The canonical create flow is the command /loop <seconds> <prompt>. The inline
dock is management-only in the current UI contract: it renders the projection
and provides Delete confirmation. It does not write events or call Agent.send().

Delete remains visible until the command succeeds and the projection reflects
the deletion. Failures keep the row and confirmation visible with accessible
error text.

The dock reads:

~~~text
useProjection('loop')
~~~

The local once-per-second countdown is presentation-only. It must not invoke
create, delete, dispatch, steer, follow-up, or any scheduler operation.

Rows use DSH styles and focus behavior, real buttons, at least 44px
interactive targets, prompt truncation with accessible full text, text plus
color for overdue/error states, and no required animation.

### 9.3 Implementation status and migration

The backend projection contract already supports the dock. The current client
files still register a conversation.view page with a card-based LoopsView.
That page is not the final UI specified here.

The UI implementation pass must make the smallest targeted change:

1. replace the page slot registration with the existing
   conversation.input.dock slot;
2. render the zero/one/two/three-plus threshold behavior from the projection;
3. keep delete on the existing command channel;
4. retain local countdown repaint only;
5. update UI tests from page navigation to dock behavior.

No backend scheduler changes are required for this migration.

## 10. Source map

~~~text
loop/
├── README.md
├── SPEC.md
├── ui.md
├── UI_DESIGN.md                 historical page draft; ui.md is current
├── cordis.patch.yml
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.client.json
├── tsdown.config.ts
├── vitest.config.ts
├── src/
│   ├── index.ts                 host registration and agent lifecycle
│   ├── loop.ts                  event fold, runtime, timer, delivery
│   ├── tools.ts                 loop_create/list/delete tools
│   ├── commands.ts              /loop parser and tool delegation
│   ├── projection.ts            session projection reducer/schema
│   ├── types.ts                 event, record, view, projection types
│   └── ui/
│       ├── index.ts              client slot registration
│       ├── LoopsView.tsx         current page; migrate to dock
│       └── LoopsView.module.css  current loop styles
└── test/
    ├── loop.test.ts              domain/runtime behavior
    ├── tools.test.ts             tool boundary behavior
    ├── commands.test.ts          command parser/delegation
    ├── projection.test.ts        projection reducer/schema
    ├── plugin.integration.test.ts real Cordis/session/tool boundary
    ├── client-entry.test.ts      client registration
    └── ui.test.tsx               current UI behavior; update for dock
~~~

lib/ and node_modules/ are generated/dependency directories and are not
hand-edited.

## 11. Test contract

The highest-value tests use real plugin boundaries and fake only the model
execution. They do not need a provider-backed agent.

Required backend test boundary:

~~~text
real Cordis context
  → real session/event log
  → real SessionPersistence flush boundary
  → real AgentRegistry lifecycle
  → real ToolRuntime registration/execution
  → fake Agent with controllable status and send spy
  → fake timers
~~~

The fake agent is the model boundary. Agent.send() remains the real delivery
call under test.

Behavior matrix:

- create, list, delete, validation, and result shapes;
- /loop <seconds> <prompt>, /loop list, and /loop delete <id>;
- session isolation and cross-session delete rejection;
- create with a one-second interval under fake timers;
- idle delivery is exactly send(message, 'next-turn', true);
- running delivery is exactly send(message, 'next-step', true);
- steer() and followup() are not called;
- heartbeat XML and plugin message source are correct;
- next_at advances after dispatch;
- missed intervals do not burst;
- multiple loops dispatch in next_at order;
- concurrent drive requests do not duplicate dispatch;
- persistence is flushed before state-changing success;
- persistence failure does not falsely advance durable state;
- replacement agent resumes from the durable session log;
- agent/plugin disposal clears timers and scoped tools;
- stale agents cannot dispatch;
- projection reflects create, dispatch, and delete;
- UI countdown repaint does not call backend mutations.

The current Vitest configuration requires 100% statements, branches,
functions, and lines for src/**/*.ts and src/**/*.tsx.

## 12. Verification commands

Run from the plugin directory. If Corepack fails with
ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING, use the already-installed local
node_modules/.bin executables instead of changing package-manager metadata.

~~~bash
NODE_OPTIONS=--experimental-require-module \
  node_modules/.bin/vitest run --coverage --maxWorkers=1

node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/tsc -p tsconfig.client.json --noEmit
node_modules/.bin/tsc -p tsconfig.json
node_modules/.bin/tsc -p tsconfig.client.json
node node_modules/tsdown/dist/run.mjs
git diff --check
~~~

The compiled host entry must be imported with the actual host-style
process.argv[1] populated because src/index.ts resolves DSH's event catalog
relative to the running entry point:

~~~bash
node --input-type=module -e \
  "process.argv[1] = process.cwd() + '/lib/index.js'; import('./lib/index.js').then(m => { if (m.name !== 'loop' || typeof m.apply !== 'function') process.exit(1) })"
~~~

The DSH core worktree must remain unchanged throughout these checks.

## 13. Definition of done

Backend v1 is complete when:

1. the three tools and three /loop command forms work in a current session;
2. seconds are the only public time unit;
3. due idle prompts use Agent.send(..., 'next-turn', true);
4. due running prompts use Agent.send(..., 'next-step', true);
5. both routes use the same session inbox and DSH wakeup mechanism;
6. event persistence, resume, isolation, missed-tick, and disposal behavior
   pass the real-boundary tests;
7. compiled host and client entries typecheck and build;
8. no DSH core file is modified.

The remaining UI definition of done comes from ui.md: migrate the existing
page registration to the inline composer dock, implement its 0/1/2/3+
display rules, and run the dock-specific E2E checks without giving the UI a
second scheduler.
