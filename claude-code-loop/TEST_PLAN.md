# claude-code-loop test plan

This plan verifies the plugin as an independently loadable DSH extension. It
does not require, and must not cause, any source change in
`deepseek-harness`.

The preferred test boundary is:

```text
real plugin + real Cordis context + real DSH tool/session services
                         |
                         +-- mocked Agent delivery methods
                         +-- mocked model/provider
                         +-- fake clock/timers
                         +-- deterministic persistence probe
```

This gives us confidence that the plugin is wired correctly into DSH while
keeping tests deterministic, fast, offline, and independent of model output.

## 1. Scope

### In scope

- Function-plugin loading and disposal.
- Installation only on root agents created after plugin load.
- Agent-scoped tool registration and cleanup.
- The four public tools:
  - `loop_create`
  - `loop_list`
  - `loop_update`
  - `loop_delete`
- Explicit loop titles, including the legacy command fallback.
- Strict input and output contracts.
- Session-local event-log folding.
- Durable create, dispatch, and delete changes.
- Persistence flush barriers and flush failures.
- Recurring timer behavior, including missed ticks.
- Delivery selection:
  - running + `allow_steer: true` -> `steer`
  - idle + `allow_steer: true` -> `followup`
  - any status + `allow_steer: false` -> `followup`
- Serialization of concurrent tool calls and timer drives.
- Agent and plugin lifecycle cleanup.
- Session/fork isolation policy.
- Session projection and GUI create/edit/delete behavior.

### Out of scope

- Testing DeepSeek model quality or prompt-following.
- Calling a real model provider, network endpoint, or user account.
- Modifying or patching `deepseek-harness` source.
- Re-testing Cordis, DSH Agent, or DSH Session internals beyond the plugin
  integration boundary.
- Proving long-term timer accuracy over wall-clock days.

## 2. Test tiers

Tests should be organized from cheapest to most realistic. A failure in an
earlier tier should be fixed before using a later tier to diagnose behavior.

| Tier | What is real | What is mocked | Purpose | Gate |
| --- | --- | --- | --- | --- |
| P0 static | TypeScript compiler and package metadata | None | Catch broken exports, types, and build output | Required on every change |
| P0 domain | Loop reducer and value validation | Clock via explicit `now` arguments | Verify deterministic state transitions | Required on every change |
| P0 tool contract | Real `defineTool` and tool registry | Agent delivery and persistence probe | Verify the model-visible API | Required on every change |
| P0 runtime | Real plugin runtime and timer scheduler | Agent, model, clock, persistence boundary | Verify delivery and rescheduling | Required on every change |
| P0 lifecycle | Real Cordis context and agent events | Agent/model internals | Verify install scope and cleanup | Required on every change |
| P1 persistence | Real Session event shape and folding | Storage backend or flush result | Verify restart/fork semantics | Required before release |
| P1 UI | Real projection/component code | Browser and network | Verify loop visibility without scheduling side effects | Required when UI ships |
| P2 smoke | Real DSH process and optional real model | None or disposable test model | Verify packaging in a real installation | Release/manual only |

The P0 suite must not make network calls, require API keys, or depend on a
real model response.

## 3. Proposed test layout

Keep the existing domain test and split additional behavior by boundary rather
than adding one large integration test.

```text
claude-code-loop/
├── src/
│   └── ui/                         # UI code, when implemented
└── test/
    ├── support/
    │   ├── fake-agent.ts           # Public Agent-shaped test double
    │   ├── fake-context.ts         # Minimal context/tool/event harness
    │   ├── fake-persistence.ts     # Flush probe and failure injection
    │   ├── fake-session.ts         # Only if DSH Session is hard to construct
    │   └── settle.ts               # Microtask/timer helpers
    ├── loop.test.ts                # Reducer, validation, occurrence math
    ├── tools.test.ts               # Tool registration and execution
    ├── delivery.test.ts            # Runtime delivery and timer behavior
    ├── persistence.test.ts         # Event log and flush barriers
    ├── lifecycle.integration.test.ts
    ├── plugin-entrypoint.integration.test.ts
    └── ui.test.tsx                 # GUI projection and CRUD behavior
```

Use the DSH/codex-shell convention of `test/**/*.test.ts` and
`*.integration.test.ts` for tests that construct a real Cordis/DSH service
graph. Do not create a general-purpose test framework or a second fake DSH
runtime; a few small test doubles are enough.

## 4. Fixture design

### 4.1 Fake Agent

`test/support/fake-agent.ts` should model only the public behavior consumed by
the plugin:

```ts
type Delivery = {
  method: 'steer' | 'followup'
  message: unknown
  accepted: boolean
}

type FakeAgent = {
  id: string
  status: 'running' | 'idle' | 'error' | 'stopped'
  session: SessionLike
  ctx: Context
  deliveries: Delivery[]
  steer(message: unknown): void
  followup(message: unknown): void
}
```

The fake must record the exact method, prompt text, source metadata, and
delivery order. It must support both successful delivery and a deliberately
thrown delivery error. It must not simulate model generation: the test only
needs to prove that the plugin calls the correct Agent API.

The fake should expose a mutable `status` so the same loop can be tested in
running, idle, and stopped states. It should also expose root/child identity so
agent-scope tests cannot accidentally pass by using one global agent.

### 4.2 Real Cordis/DSH harness

The lifecycle integration tests should use a real `Context`, the real DSH tool
registry, and real `agent/created` events. Follow the shape of the DSH schedule
plugin test harness rather than reimplementing event dispatch.

The harness should provide:

- `agents` service and root/child agent creation.
- `tools.register`, `tools.get`, and `tools.execute`.
- `sessions.flush`.
- Session event append/read behavior.
- Plugin load and disposal.

If constructing a full Agent requires a model provider, mount the existing DSH
agent-loop test dependencies and replace only the model/provider with a fake.
The plugin under test remains the actual `src/index.ts` export.

### 4.3 Fake persistence probe

The persistence fixture should record:

- flush count;
- sessions passed to `flush`;
- whether each flush resolved `true`;
- an injectable next-flush failure;
- a promise gate for testing in-flight cleanup.

The normal path should resolve `true`. A failure should resolve `false` (the
contract used by the current plugin) and must be testable without writing to
disk.

### 4.4 Clock and timers

Use Vitest fake timers for all timer tests:

```ts
vi.useFakeTimers()
vi.setSystemTime(new Date(0))
```

Pass explicit `now` values to pure functions. Advance timers only in runtime
tests. Restore real timers in `afterEach` so one test cannot leak a scheduled
loop into another.

Provide a small `settle()` helper that drains promises after advancing a timer.
Avoid arbitrary sleeps.

## 5. P0 test cases

### 5.1 Static and package preflight

These tests are commands, not Vitest cases:

```bash
cd /Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/claude-code-loop
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node --input-type=module -e "import('./lib/index.js').then(m => { if (m.name !== 'claude-code-loop') process.exit(1) })"
```

Verify:

- `src/index.ts` exports a Loader-safe function-plugin shape.
- `name === 'claude-code-loop'`.
- `inject` lists the services actually required by the plugin.
- the built entrypoint imports as ESM;
- no test uses a real network, model, or API key;
- the package files include the built plugin, patch manifest, README, and
  specification/test plan as intended;
- the plugin has no import from a local `deepseek-harness` source path.

Do not add a coverage dependency just to produce a percentage. The current
codex-shell baseline has behavioral Vitest tests but no coverage provider or
threshold. First make every P0 behavior explicit; add V8 coverage only if a
numeric release gate becomes necessary.

### 5.2 Plugin entrypoint and registration

File: `test/plugin-entrypoint.integration.test.ts`

1. Loading the actual plugin export succeeds in a real Cordis context.
2. The export is a function plugin, not a default-export-only module.
3. A root agent created before plugin load receives no loop tools.
4. A root agent created after plugin load receives exactly:
   - `loop_create`
   - `loop_list`
   - `loop_update`
   - `loop_delete`
5. Tools are agent-scoped; they are not globally visible without an agent.
6. A child agent receives no loop tools.
7. A second `agent/created` notification does not double-register tools.
8. Disposing the agent removes all four tools and stops its timer.
9. Disposing the plugin removes tools and runtimes for every attached root
   agent, including an agent whose cleanup is currently waiting on persistence.
10. An agent created after plugin disposal is not attached.

These cases are directly based on the existing DSH schedule plugin lifecycle
tests and are more important than a large number of isolated mocks.

### 5.3 Tool schema and validation

File: `test/tools.test.ts`

Verify the real registered tool definitions, not only the TypeScript argument
types:

| Case | Expected result |
| --- | --- |
| `loop_create({ prompt: 'check', time_in_seconds: 5 })` | Accepted; title is derived and `allow_steer` is `true` |
| `loop_create({ title: 'Health', prompt: 'check', time_in_seconds: 5 })` | Accepted; explicit title is preserved |
| positive integer seconds | Accepted |
| zero, negative, fractional, `NaN`, infinity, unsafe integer | Rejected |
| empty or whitespace prompt | Rejected |
| non-string prompt | Rejected |
| omitted `time_in_seconds` | Rejected |
| omitted `prompt` | Rejected |
| `allow_steer: false` | Accepted and preserved as false |
| non-boolean `allow_steer` | Rejected |
| unknown create property | Rejected by `additionalProperties: false` |
| `loop_list({})` | Accepted |
| list with unexpected arguments | Rejected if registry schema rejects extras |
| `loop_delete({ id })` for active id | Deletes exactly that id |
| empty/whitespace/unknown id | Rejected without an event append |
| `loop_update({ id, title })` | Updates title and preserves schedule |
| `loop_update({ id, prompt, allow_steer })` | Updates settings and preserves schedule |
| `loop_update({ id, time_in_seconds })` | Updates interval and reschedules from now |
| update with no mutable fields or unknown id | Rejected without an event append |

Also assert:

- descriptions say seconds are the only time unit;
- output contains `id`, `prompt`, `time_in_seconds`, `allow_steer`, `next_at`,
  `state`, and `delivery_mode`;
- `delivery_mode` is `session-local`;
- output rendering is valid JSON;
- no request-id, minute, cron, or cross-session field accidentally appears in
  the schema.

### 5.4 Domain and event folding

File: `test/loop.test.ts`

Keep these pure and fast. Use explicit timestamps and stable IDs.

1. Record creation trims the prompt and computes `next_at` in seconds.
2. Default `allow_steer` is true.
3. Explicit false remains false.
4. The generated record has a unique non-empty ID.
5. Create -> dispatch advances `next_at`.
6. Create -> delete removes the loop.
7. Dispatching an inactive loop is rejected.
8. Deleting an inactive loop is rejected.
9. Duplicate create IDs are rejected.
10. Unsupported event versions are rejected.
11. Invalid event records are rejected while folding.
12. `seedLength` ignores fork seed events according to the session policy.
13. `nextOccurrence` skips missed intervals instead of replaying a burst.
14. `loopView` reports scheduled versus overdue consistently.
15. Large but safe integer times work; overflow is rejected.
16. Event order is preserved; unrelated session events are ignored.

### 5.5 Delivery and recurring runtime

File: `test/delivery.test.ts`

Use a fake Agent, fake persistence, fake timers, and the actual
`LoopRuntime`.

1. A future loop arms one timer for the earliest active loop.
2. Multiple loops choose the earliest due loop first.
3. A due loop on a running agent with `allow_steer: true` calls `steer` once.
4. A due loop on an idle agent with `allow_steer: true` calls `followup` once.
5. A due loop with `allow_steer: false` calls `followup` even while running.
6. The delivered message contains the exact prompt and plugin source metadata.
7. A successful delivery appends one dispatch event and advances `next_at`.
8. The next occurrence is scheduled from the due occurrence, not from a burst
   of immediate retries.
9. Advancing time across several intervals delivers once and skips missed
   occurrences.
10. A loop does not deliver while its agent is no longer live in `ctx.agents`.
11. A deleted loop does not deliver after deletion and drive completion.
12. Repeated `requestDrive()` calls while a drive is running coalesce into one
   follow-up drive.
13. Concurrent due loops are serialized; one drive cannot deliver the same
   loop twice before its dispatch event is folded.
14. A delivery method that throws does not append a successful dispatch event;
   the error remains observable and the loop can be retried by the chosen
   failure policy.
15. A failed persistence flush does not report a successful create/list/delete
   or dispatch.
16. Timer delays larger than the platform maximum are chunked/capped according
   to `MAX_TIMER_DELAY_MS`.

The test must assert method calls, not merely final loop state. A test that
only sees the dispatch event could pass even if a message was never sent.

### 5.6 Persistence and restart behavior

File: `test/persistence.test.ts`

Prefer a real DSH Session object and its real event representation. Use a
flush probe instead of the storage backend when testing the plugin contract.

1. `loop_create` appends a versioned `loop/change` create event.
2. Create does not return success until its flush barrier resolves true.
3. `loop_update` appends a complete versioned update event and flushes before
   success.
4. `loop_delete` appends a versioned delete event and flushes before success.
5. Dispatch appends a versioned dispatch event with a strictly later
   `next_at` and flushes before the drive is considered complete.
6. A flush returning false rejects the operation and does not claim durability.
7. A flush rejection is propagated and does not produce a false success result.
8. Folding a new runtime from the existing event log restores active loops.
9. Deleted loops are absent after restart.
10. Updated title/settings survive restart with the expected next occurrence.
11. Dispatch state survives restart with the next occurrence intact.
12. Unrelated events do not affect loop state.
13. Two sessions do not share loop records, timers, or tool visibility.
14. A session fork follows the documented seed policy. Active loops
    are session-local and must not silently become active in a fork unless the
    fork explicitly includes the loop events by policy.
15. A malformed persisted loop event fails closed with a useful error.

The ordering contract should be explicit in the test: a dispatch is durable
only after the delivery method accepts the message and the event-log flush
completes. If delivery or persistence fails, the test must prove that no
advanced dispatch state is falsely recorded.

### 5.7 Concurrency and isolation

File: `test/delivery.test.ts` and `test/tools.test.ts`

1. Concurrent `loop_create` calls produce independent titled records and ordered
   event appends.
2. Concurrent list/update/delete operations are serialized with create
   operations.
3. Updating one loop cannot update another loop with a similar ID.
4. Deleting one loop cannot delete another loop with a similar ID.
5. A timer from session A never calls Agent B's `steer` or `followup`.
6. A tool invocation from session A cannot read session B's events.
7. A stale runtime reference cannot deliver after its agent is disposed.
8. Plugin disposal waits for an in-flight operation or safely cancels it;
   whichever behavior is selected must be asserted and documented.

Use a small number of deterministic interleavings with promise gates. Do not
build a stress harness until a race is observed; the serialized unit cases
cover the intended contract more clearly.

## 6. P1 UI tests

Add these only when `src/ui/` exists. The UI must consume a projection; it
must not own timers, append session events, or call Agent delivery methods.

File: `test/ui.test.tsx`

1. The Loops tab renders without repeating the owning session ID.
2. No active loop renders no compact summary; the page shows its empty state.
3. One and multiple loops render explicit titles, prompts, intervals, and
   scheduled/overdue state.
4. `New loop` validates title, prompt, and positive interval.
5. A valid create submits through the session command channel and renders the
   projected loop.
6. `Edit` opens prefilled values and submits title/settings changes.
7. Changing interval displays the projection-provided next run.
8. `Delete` requires confirmation and removes the card after success.
9. Mutation failures preserve user context and show an accessible error.
10. Pending actions prevent duplicate submissions.
11. Session switching replaces the projection; loop A is not visible in
    session B.
12. An empty or malformed projection fails safely and does not crash the chat
    view.
13. Rendering the UI does not start a scheduler or cause a persistence flush.
14. Modal focus, keyboard actions, labels, and non-color status text work.

These should use a projection fixture and a component test environment. Do
not mount a real agent or model for UI tests.

## 7. Real-boundary integration tests with mocked agents

This is the recommended “real but deterministic” layer.

### `plugin-entrypoint.integration.test.ts`

- Import the actual plugin module.
- Create a real Cordis context using the existing DSH testkit pattern.
- Load the actual plugin.
- Create real root and child agent containers.
- Provide a fake Agent delivery façade and fake model/provider.
- Execute tools through the real DSH tool registry.
- Inspect the real Session event stream.
- Dispose agents and plugin through the real lifecycle.

This catches wrong `inject` services, wrong event names, wrong tool scope, bad
Loader shape, and incomplete disposal while still avoiding model/network
flakiness.

### `session-persistence.integration.test.ts`

- Construct a real Session.
- Append plugin events through the actual Session API.
- Fold through the plugin reducer.
- Use a persistence probe for `sessions.flush`.
- Recreate the runtime from the same session and verify restored state.

Only use a fake Session if the real Session constructor cannot be mounted
without unrelated application state. If that fallback is needed, keep one
small compatibility test against the real Session event shape.

### `agent-delivery.integration.test.ts`

Use the actual plugin runtime and the public Agent method boundary, but replace
the Agent implementation with a recording fake. The fake model must never
generate text. The assertion is that the plugin sends the correct user message
through `steer` or `followup` and records the correct durable state.

## 8. Preflight before any real-agent smoke test

The following must pass first:

```bash
cd /Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/claude-code-loop
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Then run the compiled-entry import check. Confirm the test output contains no
skipped P0 tests and no network/model setup. If a test needs an API key or a
running DSH process, it belongs in the manual smoke tier, not preflight.

## 9. Manual real-agent smoke test

Run only after preflight passes, using a disposable DSH profile and a short
interval such as 2 seconds:

1. Start DSH with the plugin loaded.
2. Create one root session and ask the agent to call `loop_create` with a
   distinctive prompt.
3. Confirm `loop_list` returns the active loop and its session-local ID.
4. While the agent is running, confirm the next delivery is a steer.
5. Let the agent become idle and confirm a later delivery is a follow-up.
6. Restart or reload the session and confirm the loop state is restored.
7. Call `loop_delete` and confirm no further delivery occurs.
8. Close the session/plugin and confirm no timer or tool remains.

This test may use a real model only as a packaging smoke check. Its pass/fail
must not depend on the model choosing a particular wording or obeying a
particular plan; if necessary, invoke the tools directly through the DSH test
interface.

## 10. Acceptance gates

The plugin is ready for implementation completion when:

- all P0 tests pass offline;
- the real plugin entrypoint loads and disposes cleanly;
- tools are visible only on future root agents;
- all four schemas reject invalid input at the registry boundary;
- running/idle/`allow_steer` delivery behavior is proven by method-call
  assertions;
- create, dispatch, and delete state survives the intended persistence path;
- failed delivery and failed flush cannot create false durable state;
- duplicate drives and concurrent tool calls are serialized;
- session and fork isolation behavior is explicit and tested;
- UI tests, when UI ships, prove projection-only rendering;
- no file under `/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness` is changed.

## 11. Minimum first implementation batch

Do not build every test file before getting feedback. The smallest useful
implementation sequence is:

1. Expand `test/loop.test.ts` with validation, malformed events, and fork
   seed cases.
2. Add `test/tools.test.ts` using the real tool registry and fake persistence.
3. Add `test/delivery.test.ts` with fake timers and a recording Agent.
4. Add `test/plugin-entrypoint.integration.test.ts` using a real Cordis/DSH
   harness.
5. Add persistence restart tests.
6. Add UI tests only with the UI implementation.

At each step, run `pnpm typecheck && pnpm test && pnpm build`. Keep the first
release gate behavioral rather than inventing a line-coverage target.
