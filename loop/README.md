# loop

Session-scoped recurring prompts for DeepSeek Harness.

The plugin exposes three agent-local tools:

- `loop_create({ prompt, time_in_seconds })`
- `loop_list({})`
- `loop_delete({ id })`

It also registers the `/loop` command for the current agent:

- `/loop <seconds> <prompt>` creates a loop;
- `/loop list` lists active loops;
- `/loop delete <id>` deletes one loop.

The command delegates to the same agent-scoped tools, so command and model
operations share validation, persistence, and runtime scheduling.

`time_in_seconds` is the only time unit. A loop firing is delivered as a
normal user message through the session inbox with `wakeup: true`. An idle
agent uses `next-turn`; a running agent uses `next-step`, so DSH handles the
heartbeat at the earliest safe step boundary instead of waiting for the whole
turn to finish. The plugin calls `Agent.send` directly and does not call
`steer()` or `followup()`.

The message body is:

```text
<heartbeat>
  <loop_id>loop_...</loop_id>
  <prompt>Check whether the build is still healthy</prompt>
</heartbeat>
```

The loop definition and next delivery time are durable `loop/change` session
events. Timers are disposable and recreated when the session resumes. The
runtime is session-local: a stopped or cold process cannot run timers or wake
itself.

This plugin uses public DSH and Cordis APIs only; it does not modify
`deepseek-harness`. The current GUI contract is documented in [`ui.md`](./ui.md)
and the implementation contract is in [`SPEC.md`](./SPEC.md). [`UI_DESIGN.md`](./UI_DESIGN.md)
is retained as the historical page draft.
