# Implementation Prompt: dsh-codex-terminal

You are implementing the DeepSeek Harness plugin located at:

C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\codex-terminal

## Mission

Implement dsh-codex-terminal according to SPEC.md.

The plugin must provide Codex-style:

- exec_command
- write_stdin

It must be TypeScript-first, Windows-first, compatible with macOS/Linux through clear backend boundaries, and loadable as a DeepSeek Harness Cordis plugin.

## Required reading

Read these files completely before editing:

1. C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\codex-terminal\SPEC.md
2. C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness\docs\architecture.md
3. C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness\docs\cookbook\adding-a-tool.md
4. C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness\packages\subprocess\subprocess\src\types.ts
5. C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness\packages\terminal\terminal\src\types.ts
6. C:\Users\yifan\code\Ephemeral-AI-Lab\codex-upstream\codex-rs\core\src\tools\handlers\shell_spec.rs
7. C:\Users\yifan\code\Ephemeral-AI-Lab\codex-upstream\codex-rs\core\src\unified_exec\process_manager.rs

Inspect the current worktree before editing. Preserve unrelated user changes.

## Public contract

Do not add model-visible parameters beyond these:

~~~ts
exec_command({
  cmd: string
  workdir?: string
  yield_time_ms?: number
  max_output_tokens?: number
})

write_stdin({
  session_id: number
  chars?: string
  yield_time_ms?: number
  max_output_tokens?: number
})
~~~

Do not expose:

- shell
- login
- sandbox_permissions
- justification
- prefix_rule
- tty

PTY is the default transport. Pipe mode may exist only as an internal fallback.

Return Codex-compatible structured output:

~~~ts
{
  output: string
  wall_time_seconds: number
  session_id?: number
  exit_code?: number
  chunk_id?: string
  original_token_count?: number
  truncated?: boolean
}
~~~

An empty chars value means poll. Session IDs are plugin-owned opaque numeric IDs, not public operating-system PIDs.

## Implementation boundaries

Keep these layers separate:

~~~text
DHS tools
  -> session service
    -> session registry and output log
      -> PTY or pipe backend
        -> platform shell adapter
~~~

Rules:

1. Tool files must not contain platform branches.
2. Tool files must not directly call child_process or node-pty.
3. The session service owns IDs, ownership checks, polling, serialization, cancellation, and cleanup.
4. The backend owns process creation, stdin, output streams, interruption, termination, and quiescence.
5. The shell adapter owns executable resolution and shell-specific arguments.
6. Output handling must be bounded and must report truncation.
7. All sessions must be terminated during plugin or owner disposal.

## DHS integration

Implement the standard Cordis plugin entry point:

~~~ts
export const name = 'codex-terminal'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: Context): void
~~~

Use defineTool() and ctx.tools.register().

Each tool must:

- validate arguments using its schema;
- use exec.signal for cancellation;
- return one canonical JSON value;
- throw infrastructure failures;
- unregister cleanly with the Cordis lifecycle.

Do not modify DeepSeek Harness core packages unless a build or type compatibility issue proves that a minimal adapter is unavoidable. Prefer solving the issue inside this plugin.

## Platform requirements

### Windows first

Implement and test Windows behavior first:

- PowerShell 7 if available;
- Windows PowerShell 5.1 fallback;
- cmd.exe only as an explicit compatibility fallback;
- PTY through the selected cross-platform PTY library;
- pipe fallback when configured;
- process-tree termination through a safe Windows mechanism;
- UTF-8 output handling;
- Unicode and non-ASCII working directories;
- Ctrl-C behavior for PTY sessions.

### POSIX boundary

Implement the shell/backend interfaces so macOS/Linux support can be added without changing the tools or session service.

Do not assume that a PowerShell command is portable to Bash or Zsh.

## Suggested implementation order

### Phase 1: package and types

Create:

- package.json
- tsconfig.json
- README.md
- src/index.ts
- src/types.ts

Use ESM and emit declarations to lib/.

### Phase 2: session service

Implement:

- numeric ID allocation;
- owner-scoped session registry;
- per-session operation serialization;
- output cursor tracking;
- cancellation;
- disposal and process cleanup.

Reserve an ID before spawning and roll back cleanly if spawning fails.

### Phase 3: backend and shell adapter

Implement:

- platform-neutral SessionBackend;
- PTY backend;
- pipe fallback backend;
- Windows shell adapter;
- POSIX shell adapter;
- explicit termination and quiescence handling.

Use child_process.spawn() for pipes, never exec() for persistent sessions.

### Phase 4: tools

Implement exec_command and write_stdin using only the session service.

exec_command must:

1. Resolve the working directory.
2. Resolve the host shell internally.
3. Start a PTY by default.
4. Wait for the configured initial interval.
5. Return output and either an exit code or a session ID.

write_stdin must:

1. Validate the session ID and owner.
2. Serialize with other operations on that session.
3. Write input when chars is non-empty.
4. Poll when chars is empty.
5. Return incremental output and current process state.

### Phase 5: tests and integration

Add unit tests, Windows integration tests, and a minimal DHS loading test as described in SPEC.md.

Use Node-based fixtures rather than Unix-only commands such as ls, bash, or sleep.

## Security requirements

Do not accept approval or sandbox bypass parameters from the model.

Keep security policy behind a deployment-level configuration boundary. Do not silently turn an unavailable host policy into unrestricted execution in production mode.

Do not log secrets, complete environment variables, or raw internal process handles unnecessarily.

## Validation commands

Run the applicable commands after implementation:

~~~powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
~~~

Then load the compiled plugin in a minimal DHS profile and verify that both tools are registered.

At minimum, manually verify:

1. A short command returns an exit code.
2. A long-running command returns a session ID.
3. write_stdin can poll output.
4. write_stdin can send input.
5. Ctrl-C interrupts a PTY process.
6. workdir works.
7. Unicode output works.
8. Output limits are enforced.
9. Owner isolation rejects unauthorized session access.
10. Plugin disposal leaves no live child process.

## Completion requirements

Do not claim completion until:

- the package builds;
- TypeScript declarations are emitted;
- tests pass or failures are clearly documented;
- the compiled plugin loads in DHS;
- the Windows lifecycle works end-to-end;
- no references to the previous directory or plugin name remain;
- the final response lists changed files, validation commands, and any known limitations.

If a requirement cannot be implemented safely or verified, stop and explain the blocker instead of silently weakening the contract.
