## Sibling dsh / Mayfly sessions

This pane runs a DeepSeek Harness frontend (for example the Mayfly TUI). dsh
is **not** a built-in Herdr agent kind: `agent start --kind` does not cover it,
and `agent prompt` / `agent send-keys` / `agent explain` reject panes whose
agent state comes from a custom reporter. Orchestrate siblings through the
pane surface below — or, when this deployment registers the `herdr_agent_*`
tools (`herdr_agent_spawn`, `herdr_agent_prompt`, `herdr_agent_wait`,
`herdr_agent_read`), prefer them: they wrap exactly these steps and resolve
agent names to panes for you.

### Start a sibling session with a task

```bash
split=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus)
pane=$(echo "$split" | jq -r '.result.pane.pane_id')
herdr pane run "$pane" "mayfly '<task>'"        # or: dsh --profile <profile> '<task>'
```

`mayfly` accepts its first task as a positional argument, so the prompt arrives
with the process launch — no typing race. Shell-quote the task; for quotes or
multiline tasks write a file first and run `mayfly "$(cat /tmp/task.md)"`.
`pane run` needs the new pane's shell prompt rendered — if the first attempt is
swallowed by a still-starting shell, poll `pane read <pane> --source visible`
until it is non-empty, then retry.

The sibling inherits this pane's `HERDR_*` environment; once its own reporter
claims the pane (a few seconds after its session starts),
`herdr agent get <pane>` returns it — poll until it appears, then give it a
unique readable name:

```bash
herdr agent rename <pane> <name>                # [a-z][a-z0-9_-]{0,31}
```

### Drive it

```bash
herdr agent wait <name-or-pane> --until idle --timeout 120000
# `blocked` means the sibling is waiting on its own approval or question —
# read its pane and let the user answer there before prompting it again.

herdr pane read <pane> --source recent-unwrapped --lines 120
herdr pane send-text <pane> '<follow-up>'
herdr pane send-keys <pane> enter
herdr pane send-keys <pane> esc                # interrupt a running task
```

Pane commands take the pane id (`w1:p2`), not the agent name; keep the id from
the split response.

### Resume a previous session

The `agent_session_id` a sibling reports (see `herdr agent get <pane>`) can
relaunch that session in a new pane:

```bash
herdr pane run <pane> "dsh --profile mayfly --resume <session-id>"
```

### A separate project

```bash
herdr workspace create --cwd <dir> --label <name> --no-focus
```

The new workspace's first pane is a shell; run the launch command there as
above.
