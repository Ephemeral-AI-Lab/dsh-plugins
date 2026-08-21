# Ephemeral AI Harness Preset

This document specifies the Ephemeral AI agent preset and its Codex Shell integration for DeepSeek Harness.

> Baseline: DeepSeek Harness `dsh-v0.1.0-rc.8`; `dsh-codex-terminal` `0.1.3`.

## Tool surface

| Group | Tool | Arguments |
|---|---|---|
| Filesystem | `read` | `file_path:string`, `offset?:number`, `limit?:number` |
| Filesystem | `read_image` | `file_path:string` |
| Filesystem | `write` | `file_path:string`, `content:string` |
| Filesystem | `edit` | `file_path:string`, `old_string:string`, `new_string:string`, `replace_all?:boolean` |
| Jobs | `job_list` | — |
| Jobs | `job_kill` | `job_id:string`, `reason?:string` |
| Delegation | `subagent` | `description:string`, `prompt:string`, `run_in_background?:boolean` |
| Delegation | `list_agents` | `scope?:"children" | "descendants"` |
| Delegation | `send_message` | `subagent_id:string`, `message:string` |
| Research | `web_search` | `queries:string[]` |
| Shell | `exec_command` | `cmd:string`, `workdir?:string`, `yield_time_ms?:number`, `max_output_tokens?:number` |
| Shell | `write_stdin` | `job_id:string`, `chars?:string`, `yield_time_ms?:number`, `max_output_tokens?:number` |

`job_output` is intentionally hidden. Codex Shell output is collected only through `write_stdin`.

## Codex Shell runtime

`exec_command` does not expose `run_in_background`. Promotion is automatic when the process remains live after the effective `yield_time_ms`.

```text
exec_command
    |
    +-- exits inside yield window
    |       |
    |       +-- output + exit_code inline
    |       +-- no background job
    |
    +-- remains live after yield window
            |
            +-- register ctx.jobs job
            +-- return job_id: codex-terminal-N
                         |
                         +-- job_list: lifecycle status
                         +-- job_kill: terminate process
                         +-- write_stdin: send input or read unread output
```

The `codex-terminal-N` value is the only public command identifier. There is no separate numeric `session_id`.

### Example

Start a command:

```json
{
  "cmd": "sleep 2; printf 'DONE\\n'",
  "yield_time_ms": 100
}
```

Result:

```text
[job_id: codex-terminal-1]
```

List it:

```text
codex-terminal-1 [codex-terminal] running — sleep 2; printf 'DONE\n'
```

When it finishes, the owner receives:

```text
exec job codex-terminal-1 exited with code 0.
Call write_stdin with job_id="codex-terminal-1" and chars="" to collect the remaining output.
```

Collect unread output:

```json
{
  "job_id": "codex-terminal-1",
  "chars": ""
}
```

Result:

```text
DONE
[job codex-terminal-1 exited with code 0]
```

A repeated empty poll is safe:

```text
[job codex-terminal-1 exited with code 0; no unread output remains]
```

## Output behavior

Each command has one bounded output log and one consuming cursor.

- `exec_command` returns output produced during its initial yield.
- `write_stdin` returns only output not returned by an earlier successful call.
- An empty `chars` value polls without writing input.
- Already-buffered unread output returns immediately.
- If no unread output exists, the poll waits up to `yield_time_ms` for output or process exit.
- `max_output_tokens` caps one returned page. Later empty polls return the remaining pages.
- A completion notification never consumes output.
- Once terminal output is fully collected, the heavy process/output record is released.
- Lightweight owner-scoped completion metadata keeps repeated terminal polls idempotent.
- If the bounded session log overflows, Codex Shell retains the configured head and tail and inserts `<output truncated>` for the dropped middle.

`ctx.jobs` tracks lifecycle and cancellation only. Codex Shell deliberately supplies no job-output producer, and `job_output` is not exposed by this preset.

## Job completion delivery

Codex Shell settles its registered job after process exit and output quiescence. It marks the generic `job_output` notice reported. If completion happened between tool calls, it steers the owner exactly once with a compact notice that names `write_stdin` and the same job ID. A running owner consumes it at the next step; an idle owner wakes in a new turn. Codex Shell never uses `followup` for this delivery. If an active `exec_command` or `write_stdin` yield returns the terminal exit code, that tool result is authoritative and the background steer is silenced.

An idle agent is intentionally awakened so it can collect the completed command without waiting for another user message.

Owner or Codex Shell service teardown suppresses this steer rather than waking an agent being disposed.

If a delayed notice is claimed after the output was already collected, the repeated `write_stdin` call returns `no unread output remains` rather than an unknown-job error.

## Preset files

The configured user preset is stored at:

```text
~/.dsh/.agent-presets/ephemeral-ai-harness/
├── agent.cordis.yml
├── preset.yml
└── tool-surface.mjs
```

### `preset.yml`

```yaml
id: ephemeral-ai-harness
name: Ephemeral AI Harness
```

### Relevant `agent.cordis.yml` rows

```yaml
- id: codex-terminal
  name: 'dsh-codex-terminal'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

# Keep the stock job controller loaded so ctx.jobs accepts Codex Shell jobs.
# The agent restriction hides job_output.
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-control
  name: '@deepseek-ai/dsh-tool-subagent-control'

- id: tool-subagent-list-agents
  name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'

- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    backgroundMode: continuable

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: false
    searchTimeoutMs: 60000

- id: tool-surface
  name: './tool-surface.mjs'
```

### Relevant `tool-surface.mjs`

```js
const ALLOWED_TOOLS = [
  'read',
  'read_image',
  'write',
  'edit',
  'job_list',
  'job_kill',
  'subagent',
  'list_agents',
  'send_message',
  'interrupt_agent',
  'web_search',
  'exec_command',
  'write_stdin',
]
```

`job_output` must not appear in this allow-list.

## Loading and restart

Install the package into the Web profile:

```sh
dsh plugin --profile web add dsh-codex-terminal@0.1.3
```

For local development, the profile currently links the package checkout:

```text
/Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/codex-terminal
```

The package's bundle patch inserts a Host-level `codex-terminal` row. The Web profile override disables that global row so the user preset can mount exactly one agent-scoped instance.

Ordinary module HMR is disabled in the shipped Web bundle. After rebuilding Codex Shell, restart `dsh web`; editing the preset YAML alone can reload through the profile patch watcher.

## Validation checklist

1. Start a new session using `ephemeral-ai-harness`; existing sessions keep their original tool composition.
2. Confirm the tool schema contains `exec_command`, `write_stdin`, `job_list`, and `job_kill`.
3. Confirm `job_output` is absent.
4. Run a short command and verify it returns inline output with no job ID.
5. Run a command that exceeds `yield_time_ms` and verify it returns exactly one `codex-terminal-N` job ID.
6. Confirm `job_list` reports that same ID as running and then completed.
7. Confirm the completion notice uses `job_id` and instructs `write_stdin`.
8. Confirm the first empty `write_stdin` poll returns unread output and exit status.
9. Confirm a repeated empty poll returns `no unread output remains` without duplicating output.
10. Start an interactive command, send input through `write_stdin`, and verify the response remains attached to the same job ID.
11. Start a long command and verify `job_kill` stops its underlying process.

## Verified result

The assembled Web profile was verified through the loopback API without browser interaction:

```text
exec_command -> [job_id: codex-terminal-1]
job_list     -> codex-terminal-1 [codex-terminal] running
notification -> write_stdin(job_id="codex-terminal-1", chars="")
write_stdin  -> JOB_ONLY_OK + exit code 0
write_stdin  -> no unread output remains
job_list     -> codex-terminal-1 [codex-terminal] completed
```

The same request header contained no `job_output` tool and no Codex Shell `session_id` field.
