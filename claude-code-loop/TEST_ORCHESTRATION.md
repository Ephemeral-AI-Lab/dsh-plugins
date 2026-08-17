# Backend test orchestration for a DSH plugin

This note records the reasoning behind the backend test architecture for
`claude-code-loop` and should be read together with
[`TEST_PLAN.md`](./TEST_PLAN.md).

The central decision is:

> Test the real DSH/plugin integration boundary, but replace model execution
> and autonomous agent turns with a deterministic fake Agent and fake LLM.

The plugin should be exercised as a real DSH plugin. We should not reimplement
DSH services in a large fake runtime, and we should not start a real model for
every test. Those two extremes test the wrong things:

- a completely mocked DSH environment can let incorrect plugin wiring pass;
- a real model/agent process makes correctness depend on network, provider
  behavior, timing, and model decisions.

The useful middle is a real DSH service graph with controlled edges.

## 1. What the backend is actually testing

`claude-code-loop` is not just a timer utility. It crosses several DSH
boundaries:

```text
Cordis plugin lifecycle
        ↓
agent/created registration
        ↓
agent-scoped tools
        ↓
Session event log
        ↓
session persistence and flush
        ↓
timer projection
        ↓
Agent.steer() / Agent.followup()
        ↓
dispatch event and next occurrence
```

Each boundary has a different test requirement.

| Boundary | What must be proven | Recommended test object |
| --- | --- | --- |
| Pure loop domain | State transitions and validation are correct | Pure functions, no Agent |
| Cordis plugin lifecycle | The plugin loads and disposes correctly | Real Cordis context, actual plugin |
| Agent scope | Tools belong to the correct root agent | Real agent scope, fake Agent |
| Tool registration | DSH sees the exact schema and visibility | Real ToolRuntime and `defineTool` |
| Session events | Durable state is represented by events | Real Session |
| Persistence | Events survive a flush/reload boundary | Real SessionStore and temporary backend |
| Timer behavior | Due loops dispatch exactly once and rearm | Real `LoopRuntime`, fake clock |
| Delivery | Correct Agent method is selected | Fake Agent recording `steer`/`followup` |
| Model execution | Not part of core loop correctness | Mocked provider or omitted |
| Full deployment | Packaging works in an actual DSH install | Manual smoke test |

The tests should assert observable behavior at these boundaries rather than
private implementation details. For example, a delivery test should assert
that `steer()` received the right message and that a real dispatch event was
appended. It should not assert the internal name of a private promise queue.

## 2. The proposed topology

The normal integration test topology is:

```text
Vitest test
│
├── real Cordis Context
│   ├── real SessionStore
│   ├── real ToolRuntime
│   ├── real AgentRegistry
│   └── real persistence service where required
│
├── actual claude-code-loop plugin
│
├── real attached Session
│
└── fake but complete Agent
    ├── real agent-scoped Context
    ├── mutable status
    ├── steer() recorder
    ├── followup() recorder
    └── no model/turn driver
```

The plugin itself is never replaced with a fake. Cordis, Session, ToolRuntime,
AgentRegistry, and the event/persistence path should also remain real whenever
the test is intended to verify those boundaries.

The fake Agent is a controlled seam. It represents the public Agent object the
plugin receives, but it does not run a model or execute a turn.

## 3. Why not run a real Agent for every test?

The plugin needs an Agent-shaped object because its contract is agent-scoped:

- the plugin listens to `agent/created`;
- tools are registered on an agent context;
- liveness is checked through the agent registry;
- delivery uses `agent.steer()` and `agent.followup()`;
- cleanup is tied to the agent scope.

However, none of those behaviors requires an actual model turn.

If every test starts a real AgentLoop, the test becomes coupled to unrelated
behavior:

- provider setup;
- model response timing;
- request construction;
- inbox scheduling;
- status transitions;
- cancellation behavior;
- tool-call generation;
- model retries and failures.

Those are valid DSH tests, but they are not necessary to prove that the loop
plugin selected `steer` instead of `followup`, appended a dispatch event, or
restored a scheduled loop.

Therefore the default test Agent should be fake. It should record exactly what
the plugin tried to do, while the rest of the DSH infrastructure remains real.

## 4. What the fake Agent must provide

The fake Agent should be small in behavior but complete enough in shape that
the plugin cannot accidentally depend on a test-only shortcut.

Conceptually:

```ts
const fakeAgent = {
  id: 'agent-test-1',
  options: {},
  status: 'idle',
  session: realSession,
  inbox: fakeInbox,
  ctx: realAgentScopedContext,

  steer: vi.fn(),
  followup: vi.fn(),
  inject: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  whenIdle: vi.fn(),
  runMaintenance: vi.fn(),
}
```

The exact TypeScript implementation should conform to the installed DSH Agent
type, but the behavioral requirements are simple:

1. `id` is stable and unique per fixture.
2. `session` is a real Session object.
3. `status` is mutable between `running`, `idle`, and stopped/dead states.
4. `steer()` records the received message and can optionally throw.
5. `followup()` records the received message and can optionally throw.
6. `ctx` is a real agent-scoped context, not merely `new Context()`.
7. `ctx.agents.get(agent.id)` returns this exact object while it is live.
8. The fixture can remove the Agent from the registry to test stale-runtime
   liveness checks.
9. Disposal can block on an intentionally unresolved persistence operation.

The fake should not generate text, create tool calls, or make network requests.
If a test needs a model response, that test belongs to the optional real
AgentLoop layer and should use a scripted LLM adapter.

## 5. Use the existing DSH testkit

The plugin tests should reuse DSH's existing test composition instead of
creating a second fake DSH runtime.

The preferred base is the DSH agent-loop testkit, which mounts the real core
services needed by plugin tests:

1. LLM runtime;
2. SessionStore;
3. system prompt service;
4. ToolRuntime;
5. AgentRegistry.

The testkit does not need to start an AgentLoop or connect an LLM adapter for
the default plugin tests. That is useful: it gives the plugin the same service
registries it uses in production without making a model call.

The test harness should therefore compose services in this order:

```text
new Context()
    ↓
mountAgentLoopTestDependencies(ctx)
    ↓
mount temporary persistence when persistence is in scope
    ↓
mount claude-code-loop
    ↓
create/attach Session
    ↓
create fake Agent with a real scope context
    ↓
register and announce the Agent
    ↓
exercise plugin
```

The actual imports and helper names should follow the DSH version installed by
the plugin rather than copying internal DSH implementation code.

## 6. Session construction: detached versus attached

This distinction is important.

### Detached in-memory Session

`Session.create(id)` is useful for pure event-log tests. It gives a session
whose events can be appended, folded, and inspected in memory.

It is not sufficient for tests that claim to exercise the DSH persistence
boundary because it is not necessarily attached to a SessionStore and does
not necessarily publish through the normal `session/event` path.

Use a detached Session for:

- pure folding tests;
- domain tests;
- lightweight timer tests where persistence is deliberately replaced by a
  probe;
- tests that only need a stable event array.

### Store-attached Session

For real backend/persistence tests, use the real SessionStore:

```text
ctx.sessions.create(sessionId, options)
```

or use the lower-level lifecycle when exact ordering is required:

```text
ctx.sessions.prepare(sessionId, options)
ctx.sessions.enter(session)
ctx.sessions.announce(session)
```

An attached Session lets the test observe the actual event path:

```text
session.append('loop/change', data)
        ↓
session/event publication
        ↓
persistence coordinator queue
        ↓
await ctx.sessions.flush(session)
        ↓
durable backend state
```

The test must wait for `ctx.sessions.flush(session)` before attempting to load
or inspect durable state. `agent.whenIdle()` is not a substitute; an Agent can
be idle while persistence writes are still queued.

## 7. Persistence orchestration

Persistence should be tested in two modes.

### Mode A: deterministic flush probe

Most tool and runtime tests should use a fake `sessions.flush` boundary that
is deterministic and can be controlled with a promise gate.

The probe should record:

- each flush call;
- the Session passed to the call;
- the events visible at that point;
- whether the call returns `true`;
- whether the call returns `false`;
- whether the call rejects;
- whether a test deliberately holds the flush unresolved.

This is ideal for checking ordering:

```text
create:
  flush sees no create event
  append create event
  flush sees create event

dispatch:
  Agent accepts message
  append dispatch event
  flush sees dispatch event
```

This mode is fast and makes failure paths easy to test.

### Mode B: real temporary persistence backend

At least one integration suite should use a real persistence implementation,
such as JSONL persistence, with a temporary directory.

The sequence should be:

```text
create temporary directory
    ↓
mount real persistence plugin
    ↓
create attached Session
    ↓
append loop events
    ↓
await ctx.sessions.flush(session)
    ↓
load persisted session
    ↓
construct a fresh Session/runtime
    ↓
verify restored loop behavior
```

This suite proves that the plugin's event representation is compatible with
the real DSH persistence path. It should run with a unique temporary directory
per test or per test file and should always clean it up.

The real persistence test should not inspect implementation-specific JSONL
lines unless necessary. Prefer the backend-neutral load/read API. File-level
assertions are useful only for a separate persistence backend test.

## 8. Tool orchestration

Tool tests should keep the real tool registration and execution pipeline.

The preferred path is:

```text
real registerLoopTools()
    ↓
real ctx.tools.register()
    ↓
real ctx.tools.get()/lookup
    ↓
real ctx.tools.execute()
    ↓
real schema validation
    ↓
real tool body
    ↓
real Session append
    ↓
flush probe or real persistence
```

Do not only call the internal `execute()` callback for the main tool tests.
That would skip the schema and visibility behavior the model actually sees.

Direct callback invocation is acceptable for a small unit test of an internal
helper, but it is not sufficient for the backend plugin integration suite.

The tool tests should verify:

- the exact four tool names;
- agent-local visibility;
- no accidental global registration;
- real input validation;
- real output rendering;
- title fallback and explicit title behavior;
- create/list/update/delete event ordering;
- update isolation and schedule semantics;
- exact disposer behavior;
- no tool remains after Agent/plugin disposal.

For CRUD tests that are not about timer behavior, the runtime's background
drive can be suppressed or controlled. This prevents a tool test from
accidentally becoming a timer test. Timer behavior belongs in
`delivery.test.ts`.

## 9. Timer orchestration

Timers should never use real wall-clock waiting in the core suite.

Use Vitest fake timers:

```text
beforeEach:
  vi.useFakeTimers()
  vi.setSystemTime(0)

test:
  start runtime
  await bounded timer advancement
  await settle pending promises

afterEach:
  vi.useRealTimers()
  vi.restoreAllMocks()
```

Use bounded operations such as `advanceTimersByTimeAsync`. Do not use an
unbounded `runAllTimersAsync()` for recurring loops because a healthy loop
continues to schedule future occurrences indefinitely.

Timer assertions should focus on observable behavior:

1. no delivery before `next_at`;
2. exactly one delivery at the due boundary;
3. correct `steer`/`followup` method;
4. one dispatch event;
5. strictly advanced `next_at`;
6. no burst after missed intervals;
7. no delivery after disposal;
8. no delivery into a replacement Agent with the same ID.

The test should not depend on private timer handle names or promise queue
implementation details.

## 10. Plugin lifecycle orchestration

The lifecycle test must use the actual plugin `apply()` function.

The recommended publication order is:

```text
1. Create root Context.
2. Mount DSH services.
3. Mount claude-code-loop.
4. Create a root Agent/session.
5. Publish agent/created.
6. Assert tools/runtime are attached.
7. Exercise the plugin.
8. Dispose Agent scope.
9. Assert Agent tools/timers are gone.
10. Dispose plugin.
11. Assert no future Agent can be attached.
12. Dispose the root Context.
```

The test must cover both scope and load order:

```text
Agent created before plugin load  -> no loop tools
Agent created after plugin load   -> loop tools attached
Child Agent                       -> no loop tools
Plugin disposed                   -> all loop tools removed
Agent disposed                    -> its timer is stopped
```

This is not incidental behavior. It is the plugin's ownership model and must
be made explicit in the test suite.

When testing the actual Agent lifecycle, use DSH's AgentRegistry APIs and
agent event dispatch. A plain `new Context()` assigned to `agent.ctx` is not a
real agent scope and can let scope bugs pass.

## 11. When to use a real AgentLoop

The real AgentLoop should be a separate optional suite, not the foundation of
the plugin test suite.

Use it only when the assertion depends on actual AgentLoop behavior:

- a status transition is generated by the real turn loop;
- an inbox message is claimed by the real Agent;
- a tool call is generated by the LLM adapter;
- the plugin listens to a real turn lifecycle event;
- cancellation or abort ordering is under test.

In that suite:

```text
real AgentLoop
real DSH services
real plugin
scripted/mock LLM adapter
no network
no provider account
```

The scripted adapter should return fixed text or fixed tool calls. It should
also be able to simulate a blocked request, an error, and an abort if those
paths are relevant.

The plugin's basic loop delivery tests do not need this suite. A fake Agent
with a mutable `status` is more direct and makes the `steer` versus `followup`
policy unambiguous.

## 12. Failure-path orchestration

The most valuable backend tests are not only happy paths. The harness must be
able to stop each boundary independently:

### Delivery failure

```text
loop is due
    ↓
fake steer()/followup() throws
    ↓
assert no successful dispatch event
assert loop is not advanced as delivered
```

### Persistence failure before mutation

```text
flush returns false/rejects before create/delete
    ↓
operation rejects
assert no unintended state change
```

### Persistence failure after mutation

```text
append event
    ↓
post-append flush fails
    ↓
operation does not report durable success
inspect whether in-memory event remains, as documented
```

### Disposal during in-flight work

```text
drive begins
    ↓
flush is held unresolved
    ↓
runtime.dispose() starts
    ↓
flush resolves
    ↓
assert no delivery occurs after disposal policy takes effect
```

This last test is particularly important because lifecycle cleanup and
in-flight asynchronous work are easy to get subtly wrong. The test should
establish the intended behavior before implementation details are changed.

## 13. Session isolation orchestration

Isolation should be tested with two real Sessions and two fake Agents inside
one real root Context.

```text
Session A / Agent A
Session B / Agent B
```

Then verify:

```text
A creates loop A
B lists loops              -> []
B deletes loop A           -> error
A lists loops              -> [loop A]
A becomes due              -> only A receives delivery
B remains unaffected
```

Also test disposal independently:

```text
dispose A
advance time
assert A does not deliver
assert B still delivers normally
```

Loop IDs are session-local. The same explicit loop ID may exist in two
different sessions; that is valid because the Session is the ownership scope.

## 14. Test file organization

The minimum useful test structure is:

```text
test/
├── support/
│   ├── fake-agent.ts
│   ├── fake-loop.ts
│   ├── fake-persistence.ts
│   └── settle.ts
├── loop.test.ts
├── tools.test.ts
├── delivery.test.ts
├── persistence.test.ts
├── plugin-entrypoint.integration.test.ts
└── ui.test.tsx
```

If `fake-loop.ts` becomes the only shared fixture, do not add both
`fake-agent.ts` and another overlapping fixture. The fixture should remain
small and composable. We do not need a framework for generating arbitrary DSH
graphs.

UI tests should be added separately when `src/ui/` exists:

```text
test/ui.test.tsx
```

The UI suite should consume projected session state and a mocked session
command channel. It should cover title rendering, create/edit/delete flows,
validation, pending/error states, keyboard interaction, and must not
instantiate schedulers, write events, or call Agent methods.

## 15. Test execution stages

The backend test process should be staged.

### Stage A: static preflight

```bash
pnpm typecheck
```

This catches type, export, and DSH peer API mistakes before runtime setup.

### Stage B: deterministic unit/integration suite

```bash
pnpm test
```

This runs:

- pure domain tests;
- real tool registration tests;
- fake-timer runtime tests;
- fake-Agent lifecycle tests;
- persistence probe tests.

No network or model call is permitted here.

### Stage C: build/import preflight

```bash
pnpm build
node --input-type=module -e "import('./lib/index.js').then(m => { if (m.name !== 'claude-code-loop') process.exit(1) })"
```

This verifies that the package actually produces a loadable plugin artifact.

### Stage D: real temporary persistence integration

Run the subset that mounts the real persistence backend and uses a temporary
directory. This can still be offline and deterministic.

### Stage E: optional AgentLoop simulation

Run only if lifecycle/turn behavior is part of the current change.

### Stage F: manual DSH smoke test

Only after all deterministic stages pass should we run a disposable real DSH
session. This is a packaging and deployment check, not the main correctness
suite.

## 16. Parallelism and isolation

Vitest may run independent test files in parallel, but each test must own its
state:

- fresh Context;
- fresh Session;
- fresh fake Agent;
- unique temporary persistence directory;
- restored fake timers;
- explicit plugin/Agent disposal.

Do not use a global Context or global Session to make tests faster. A shared
context causes exactly the kinds of bugs this plugin must avoid: duplicate
tools, leaked timers, cross-session events, and stale agents.

If a test intentionally controls a single queue or fake timer set, make that
scope local to the test. Use sequential execution only for a small test group
that has an unavoidable shared external resource; do not make the entire
suite sequential by default.

## 17. What counts as a passing backend test

A backend test should pass only when the relevant public observation is right.
Examples:

| Behavior | Required observation |
| --- | --- |
| Tool registration | Real tool registry returns the exact tool for the intended Agent and not for another Agent/global scope |
| Create | Tool result, Session event, and persistence flush all agree |
| Delivery | Correct fake Agent method receives the exact prompt message |
| Dispatch | Real Session contains a valid advanced dispatch event |
| Resume | A new runtime reconstructed from persisted events behaves correctly |
| Cleanup | Tool registry, timer set, registry ownership, and queued work are clean |
| Isolation | Session A cannot list, delete, or receive Session B's loops |

A test should not pass merely because an internal map contains the expected
record. The durable event log and public DSH registries are the contract.

## 18. What is deliberately not built

The first version should not add:

- a custom fake Cordis implementation;
- a custom fake Session implementation for all tests;
- a custom fake ToolRuntime;
- a model-quality test suite;
- long-duration wall-clock tests;
- a distributed scheduler test;
- cross-process timer coordination;
- a new production abstraction solely to make tests easier;
- changes to `deepseek-harness`.

The plugin should expose test seams through its existing public boundaries:

- `apply()`;
- `registerLoopTools()`;
- `LoopRuntime`;
- loop event folding;
- DSH Session and ToolRuntime APIs.

If a test cannot reach a behavior through these boundaries, first verify that
the behavior is actually part of the plugin contract before adding a new
production hook.

## 19. Final orchestration decision

The recommended backend strategy is therefore:

```text
Pure domain tests
        ↓
Real DSH services + real plugin + fake Agent
        ↓
Real attached Session + real persistence backend
        ↓
Optional real AgentLoop + scripted fake LLM
        ↓
Manual real-agent smoke test
```

The majority of tests should stop at the second or third stage. They should
simulate real plugin operation without a real autonomous agent. The optional
AgentLoop stage exists only for behavior that genuinely depends on AgentLoop
semantics.

This gives us realistic backend coverage, deterministic failures, fast local
feedback, and a strict plugin-only boundary. No source change in
`deepseek-harness` is required for this orchestration.
