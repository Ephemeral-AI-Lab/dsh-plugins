# claude-code-loop

Session-scoped recurring prompts for DeepSeek Harness.

The plugin exposes three agent-local tools:

- `loop_create({ prompt, time_in_seconds, allow_steer? })`
- `loop_list({})`
- `loop_delete({ id })`

It also registers the `/loop` command for the current agent:

- `/loop <seconds> <prompt>` creates a loop without a separate create verb;
- `/loop list` lists active loops;
- `/loop delete <id>` deletes one loop.

The command delegates to the same agent-scoped tools, so command and model
operations share validation, persistence, and runtime scheduling.

`time_in_seconds` is the only time unit. `allow_steer` defaults to `true` and is stored in the session event log.

Delivery is state-aware:

- A running agent receives `steer()` when `allow_steer` is true.
- An idle agent receives `followup()` so each loop iteration starts as a normal turn.
- When `allow_steer` is false, the plugin always uses `followup()`.

The loop definition and next delivery time are durable `loop/change` session events. Timers are disposable and recreated when the session resumes. The plugin only attaches to root agents created after the plugin loads.

This plugin uses public DSH and Cordis APIs only; it does not modify `deepseek-harness`.
The backend v1 intentionally stops at the host/runtime surface and ships no
browser-side replay or scheduler. The UI contract and the next browser
implementation boundary are drafted in [`UI_DESIGN.md`](./UI_DESIGN.md).
