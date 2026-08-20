# Backend test orchestration

This document defines the smallest realistic test harness for
`loop`. It deliberately tests the real DSH/plugin boundaries while
keeping model execution and wall-clock waiting out of the suite.

## Boundary topology

```text
Vitest
  └─ real Cordis Context
      ├─ real SessionStore / Session
      ├─ real SessionProjection
      ├─ real AgentRegistry
      ├─ real ToolRuntime
      ├─ real CommandRuntime
      ├─ real loop plugin
      └─ fake Agent delivery edge
           └─ send(message, target, wakeup) recorder
```

The fake Agent has a real agent-scoped Cordis context and a real Session. It
does not run an AgentLoop or model. The runtime must therefore use the same
public `Agent.send` boundary it would use in production; it must not receive a
test-only shortcut.

## What `Agent.send` means here

DSH's public Agent inbox API accepts a message, a target, and a wake flag:

```ts
agent.send(message, agent.status === 'running' ? 'next-step' : 'next-turn', true)
```

`next-turn` is the normal later-turn inbox for an idle agent. `next-step` is
consumed by a running agent at the earliest safe step boundary. `true` permits
DSH to wake an idle live agent so it actually processes the prompt. `next-step`
cannot interrupt a model or tool operation already executing. If the process is
stopped, no timer or driver is alive; resuming the session is what recreates the
runtime.

Tests must assert all three arguments and must assert that `steer` and
`followup` are not called. That is the contract, not an implementation detail.

## Real services and controlled seams

Keep these real:

- Cordis plugin lifecycle and effects;
- DSH AgentRegistry and root/child scope;
- DSH Session event append/read/folding;
- Session flush boundary;
- ToolRuntime schema registration and execution;
- CommandRuntime parsing/execution;
- session projection registration and application;
- the actual loop timer runtime.

Control these:

- `Agent.send` with a Vitest spy;
- model/provider execution by omitting the AgentLoop;
- time with `vi.useFakeTimers()` and `vi.setSystemTime()`;
- persistence outcomes with the existing flush listener/probe;
- failures with deterministic rejected promises or thrown errors.

This avoids both bad extremes: a fully mocked DSH graph can hide wiring bugs,
while a real provider makes the test depend on network, model output, and
unrelated turn scheduling.

## Fake Agent requirements

The integration fixture should provide only the public shape the plugin uses:

```ts
const agent = {
  id: 'agent-test-1',
  status: 'idle',
  session: realSession,
  ctx: realAgentScopedContext,
  send: vi.fn(),
  // spies used only to prove the removed paths stay unused
  steer: vi.fn(),
  followup: vi.fn(),
}
```

The fixture must support:

1. distinct root agents and sessions;
2. mutable status without requiring a real model turn;
3. removal from the real AgentRegistry;
4. disposal of the real agent scope;
5. a flush listener that can return false or throw;
6. inspection of the exact `UserMessage` passed to `send`.

Do not add a fake inbox implementation: the plugin's seam is the public Agent
method, and DSH owns inbox insertion and wake semantics.

## Test sequencing

Run cheap deterministic checks first:

1. pure loop/reducer tests;
2. command parser tests;
3. projection tests;
4. real Cordis/DSH integration tests;
5. UI tests;
6. V8 coverage;
7. TypeScript and build/import checks.

Use `--maxWorkers=1` for stable timings and fake-timer ownership. Every test
must restore real timers and dispose agent/plugin scopes in `afterEach`.

## Timer protocol

Never wait for a real one-second loop in the core suite. The smoke equivalent
is deterministic:

```text
vi.useFakeTimers({ now: 0 })
create loop with time_in_seconds = 1
advanceTimersByTimeAsync(999)  -> send count 0
advanceTimersByTimeAsync(1)    -> send count 1
assert idle target = next-turn, wakeup = true
set fake Agent status = running
dispatch a due loop
assert running target = next-step, wakeup = true
advance through another interval -> send count 2
```

For multiple loops, create two records with different due times in one real
Session, advance the clock across both boundaries, and assert two sends with
two loop IDs. Never use `runAllTimersAsync()` for a recurring loop because it
would intentionally run forever.

## Failure and ordering assertions

The runtime must be tested at the observable ordering boundaries:

```text
create/delete:
  validate -> append loop/change -> flush -> command success

dispatch:
  construct heartbeat -> Agent.send -> append dispatch -> flush -> re-arm
```

Assert that:

- invalid input appends no event;
- false/rejected flush does not report success;
- a send failure does not append a successful dispatch;
- dispatch advances from the due occurrence and skips missed ticks;
- concurrent drive requests cannot send the same loop twice;
- disposal clears the timer and prevents later sends;
- stale registry entries cannot receive delivery.

## Session isolation

Use two real Sessions and two root Agents in one Cordis context:

```text
A creates loop A
B lists                         -> []
B deletes loop A                -> error
A lists                         -> [loop A]
A becomes due                   -> only Agent A.send called
```

Then dispose A, advance fake time, and verify B's independent loop still
works. Session IDs never belong in the loop command or heartbeat payload
beyond the normal enclosing session context.

## UI orchestration

The UI test mounts the actual `LoopsView` with:

- a projection fixture;
- a mocked command-channel function;
- jsdom and fake timers for countdown rendering.

It must not mount a scheduler, Agent, Session, or model. Creation is tested at
the command/tool boundary; the UI only verifies the `/loop <seconds> <prompt>`
empty-state guidance, projected loop rows, confirmation/error/pending delete
behavior, long-prompt display shortening, and the absence of an owning
session ID.

## Coverage and execution

The V8 thresholds are 100% for statements, lines, functions, and branches.
Run the local binary fallback when Corepack/pnpm reports
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`:

```bash
NODE_OPTIONS=--experimental-require-module node_modules/.bin/vitest run --coverage --maxWorkers=1
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/tsc -p tsconfig.client.json --noEmit
node_modules/.bin/tsc -p tsconfig.json
node_modules/.bin/tsc -p tsconfig.client.json
node node_modules/tsdown/dist/run.mjs
git diff --check
```

The final audit must show no changed file below the separate DeepSeek Harness
source checkout.
