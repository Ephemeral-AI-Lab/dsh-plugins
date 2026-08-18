# ⏰ dsh-loop

Adds session-scoped recurring alarms to DeepSeek Harness.

## 🚀 Release: 0.1.2

This initial release lets an agent set recurring self-prompts, deliver them
through the active session, and manage them from the web UI. Alarms are
session-local and durable across session resume.

## 1. 📦 Install the plugin

The stable npm release is available through both DSH and npm:

~~~powershell
# With the DSH CLI:
dsh plugin --profile web add dsh-loop@0.1.2

# Without the `dsh` CLI:
npm install dsh-loop@0.1.2
~~~

For a pinned Git-source install, the marketplace can pin a full Git commit and
the `loop` monorepo path, then delegate the package change to the official DSH
CLI. A direct fixed-source spec has this shape:

~~~powershell
dsh plugin --profile web add "git+https://github.com/Ephemeral-AI-Lab/dsh-plugins.git#<40-character-commit>&path:loop"
~~~

The plugin is installed into the selected DSH profile. Restart DSH and create
a new session after installing it.

The fixed Git source contains the compiled `lib` directory and has no
`preinstall`, `install`, `postinstall`, or `prepare` lifecycle script. Consumer
installs therefore do not download the development toolchain or build the
plugin. Contributors must run `pnpm build` and commit the regenerated `lib`
files whenever `src` changes.

## 2. ⏱️ Set recurring alarms

The simplest user-facing request is natural language:

~~~text
Set a recurring alarm to ask yourself to check the code every 10 seconds.
~~~

For a presentation with multiple independent alarms:

~~~text
Set up four independent recurring alarms for this session:

- Set a recurring alarm to ask yourself to inspect the latest errors, identify
  the most likely cause, and recommend the next fix every 20 seconds.
- Set a recurring alarm to ask yourself to review the project tasks, find the
  biggest blocker, and update the priority order every 30 seconds.
- Set a recurring alarm to ask yourself to check the research notes, compare
  them with the current hypothesis, and propose the next experiment every
  45 seconds.
- Set a recurring alarm to ask yourself to inspect the draft, find the three
  most important weaknesses, and suggest concrete revisions every 60 seconds.
~~~

Each alarm is independent. It has its own interval, prompt, next-delivery
countdown, and ID, so one alarm can be removed while the others continue.

## 3. 🛠️ Agent tools and command interface

The plugin exposes three agent-local tools:

- loop_create({ prompt, time_in_seconds })
- loop_list({})
- loop_delete({ id })

It also registers the /loop command for direct command-driven sessions:

- /loop <seconds> <prompt> creates an alarm;
- /loop list lists active alarms;
- /loop delete <id> removes one alarm.

Both interfaces use the same validation, persistence, and scheduling path.

## 4. 🖥️ Web UI

The web client adds a compact Loop dock for the current session. It shows:

- the number of active alarms;
- each alarm's interval and next-delivery countdown;
- the full prompt on demand;
- an expand/collapse control for multiple alarms;
- a direct delete button with no confirmation step.

Deleting an alarm sends the normal delete operation and removes the row when
the projected session state confirms the change.

## 5. 🔄 How delivery works

time_in_seconds is the only time unit. When an alarm is due, its prompt is
delivered as a normal user message through the session inbox with
wakeup: true.

- An idle agent receives the heartbeat through next-turn.
- A running agent receives it through next-step.

This lets DSH process the reminder at the earliest safe step boundary without
interrupting the current operation. The plugin calls Agent.send directly and
does not call steer() or followup().

The delivered message has this shape:

~~~text
<heartbeat>
  <loop_id>loop_...</loop_id>
  <prompt>Check whether the build is still healthy</prompt>
</heartbeat>
~~~

Loop definitions and next-delivery times are durable loop/change session
events. Timers are disposable and recreated when the session resumes. The
runtime is session-local: a stopped or cold process cannot run timers or wake
itself.

## 6. ✅ Verify locally

Run the full Loop test suite:

~~~powershell
pnpm test -- --maxWorkers=1
~~~

Run the focused E2E suite:

~~~powershell
pnpm test:e2e
~~~

Run typechecks and build the published artifacts:

~~~powershell
pnpm typecheck
pnpm typecheck:client
pnpm build
~~~

The reusable agent-facing scenarios are in
[e2e-test-prompt.md](./e2e-test-prompt.md). The executable test runner remains
in the source repository at test/e2e.test.ts.

## 7. 📦 Package scope

This plugin uses public DSH and Cordis APIs only; it does not modify
deepseek-harness. The implementation contract is documented in
[SPEC.md](./SPEC.md), and the web UI contract is documented in
[ui.md](./ui.md).

## 📚 Documentation

- [Implementation specification](./SPEC.md)
- [Web UI contract](./ui.md)
- [Reusable E2E test prompts](./e2e-test-prompt.md)
- [Test plan](./TEST_PLAN.md)
- [Test orchestration](./TEST_ORCHESTRATION.md)
