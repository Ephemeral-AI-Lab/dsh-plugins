# loop test plan

This plan verifies the plugin as an independently loadable DSH extension. It
does not require, and must not cause, any source change in
`deepseek-harness`.

## v1 contract under test

The public surface is intentionally small:

- `loop_create({ prompt, time_in_seconds })`
- `loop_list()`
- `loop_delete({ id })`
- `/loop <seconds> <prompt>`
- `/loop list`
- `/loop delete <id>`

There is no separate loop title and no direct steer/follow-up API usage. At the
due time, the runtime creates one plugin-sourced heartbeat and adapts its inbox
target:

```ts
agent.send(message, agent.status === 'running' ? 'next-step' : 'next-turn', true)
```

`next-turn` is the normal later-turn inbox for an idle agent. `next-step` is
consumed by a running agent at the earliest safe step boundary. `true` lets DSH
wake an idle live agent so the prompt is actually processed. This cannot
interrupt a model or tool operation already executing. A stopped or cold
process cannot run its timer or wake itself; durable loop events are
reconstructed when the session is resumed.

The preferred boundary is:

```text
real plugin + real Cordis + real DSH Session/ToolRuntime/CommandRuntime
                         |
                         +-- mocked Agent.send/model boundary
                         +-- Vitest fake timers
                         +-- deterministic flush probe
```

The suite must not call a network provider, require an API key, or depend on
model output.

## Test tiers

| Tier | Real components | Controlled components | Gate |
| --- | --- | --- | --- |
| P0 domain | loop reducer and validation | explicit timestamps | every change |
| P0 command/tool | real CommandRuntime and ToolRuntime | Agent delivery | every change |
| P0 runtime | real Cordis, Session, AgentRegistry, runtime | `Agent.send`, clock, flush result | every change |
| P0 projection/UI | real projection and React component | projection fixture, command channel | UI changes |
| P0 static | TypeScript and package build | none | release |
| P1 smoke | real DSH process | disposable session/model if needed | manual release check |

Do not run a real model in P0. A model cannot improve confidence in timer,
event, inbox, or schema behavior and makes timing failures nondeterministic.

## Test organization

The current implementation keeps the suite compact:

```text
test/
├── commands.test.ts              # /loop parser and command execution
├── loop.test.ts                  # pure state, folding, timer math, runtime
├── plugin.integration.test.ts    # real Cordis/DSH boundary with fake Agent
├── projection.test.ts            # session projection and legacy normalization
└── ui.test.tsx                   # projection-only GUI CRUD and formatting
```

## Required behavior matrix

### Domain and event log

- create trims and validates a non-empty prompt;
- only positive safe-integer seconds are accepted;
- `next_at` is `now + interval` in milliseconds;
- generated IDs are non-empty and session-local;
- create, dispatch, update compatibility, and delete events fold correctly;
- duplicate IDs and malformed records fail closed;
- inactive delete/dispatch/update operations fail;
- missed intervals advance to the next future occurrence without a burst;
- scheduled versus overdue views are deterministic;
- fork seed length and unrelated session events do not leak loop state;
- heartbeat XML escapes `&`, `<`, `>`, `"`, and `'`.

### Command and tool boundary

- real registry exposes exactly the three loop tools;
- `loop_create` accepts only prompt and interval;
- unknown create fields are rejected by the registry schema;
- list and delete have strict inputs and output shapes;
- `/loop 1 check the build` keeps the complete remainder as the prompt;
- `/loop list` and `/loop delete <id>` dispatch through real ToolRuntime;
- malformed commands return the usage string;
- tool mutations flush before success and fail on rejected/false flushes;
- no tool is visible on a child agent or after disposal.

### Runtime and inbox delivery

Using Vitest fake timers and a real Session:

- future loops arm the earliest timer;
- a 1-second loop sends exactly once at its due boundary;
- multiple loops in the same session each generate one independent inbox send;
- every send has `wakeup === true`;
- an idle live agent receives `next-turn` and is woken by DSH;
- a running agent receives `next-step` at the earliest safe boundary;
- the heartbeat contains the correct loop ID and prompt;
- `steer` and `followup` are never called;
- dispatch appends one durable `loop/change` event and advances `next_at`;
- missed ticks do not create a burst;
- concurrent drives serialize and do not duplicate a loop;
- stale/disposed agents do not receive delivery;
- a delivery or flush failure cannot report false durable success;
- resuming a session reconstructs its active loops and timers;
- session A never lists, deletes, or receives session B's loops.

### Projection and UI

- the loop dock is session-scoped and does not render the owning session ID;
- empty, scheduled, overdue, minute, hour, mixed, and long-prompt states render;
- creation uses `/loop <seconds> <prompt>` and appears through the projection;
- the UI has no create form or duplicate prompt/interval controls;
- delete requires confirmation and closes after projected removal;
- pending, malformed, rejected, and thrown command results remain accessible;
- rendering does not create timers, append events, or call Agent methods.

## Numeric coverage gate

`vitest.config.ts` uses the V8 provider with 100% thresholds for statements,
lines, functions, and branches across `src/**/*.ts` and `src/**/*.tsx`.
Coverage is a release gate, not a substitute for boundary assertions: tests
must still inspect the actual `send` arguments, Session events, flush order,
and UI command strings.

## Exact checks

Run from the plugin directory. If Corepack/pnpm fails with
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`, invoke the local binaries directly:

```bash
NODE_OPTIONS=--experimental-require-module node_modules/.bin/vitest run --coverage --maxWorkers=1
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/tsc -p tsconfig.client.json --noEmit
node_modules/.bin/tsc -p tsconfig.json
node_modules/.bin/tsc -p tsconfig.client.json
node node_modules/tsdown/dist/run.mjs
git diff --check
```

The compiled host entry should also import without starting an agent:

```bash
node --input-type=module -e "import('./lib/index.js').then(m => { if (m.name !== 'loop' || typeof m.apply !== 'function') process.exit(1) })"
```

No check may modify `/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness`.

## Manual smoke check

Only after the offline gate passes, use a disposable DSH profile:

1. Load the compiled plugin and create a fresh session.
2. Create `/loop 1 LOOP_SMOKE_OK`.
3. Confirm `loop_list` and the Loops page show the loop.
4. Wait for one heartbeat in the session's message inbox.
5. Confirm the idle agent wakes and processes the heartbeat; if already
   working, confirm the message is handled at the next-step boundary.
6. Create a second loop in the same session and confirm both are queued and
   processed independently.
7. Delete both and verify no later delivery occurs.
8. Dispose the disposable profile and verify cleanup.

This manual check is for packaging and host integration. The automated suite
is the authoritative correctness gate.

## Definition of done

- all five test files pass;
- coverage is 100% for statements, lines, functions, and branches;
- real DSH/Cordis/Session/ToolRuntime boundaries are exercised;
- fake timers cover the 1-second recurring case and multiple loops per session;
- Agent/model execution remains mocked and offline;
- inbox delivery adapts between `next-turn` while idle and `next-step` while
  running, always with `wakeup: true`;
- UI and backend agree on prompt-plus-seconds only;
- build/import/diff checks pass;
- no `deepseek-harness` source file is changed.
