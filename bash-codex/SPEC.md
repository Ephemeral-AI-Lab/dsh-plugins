# bash-codex

Status: Draft implementation specification

## 1. Purpose

bash-codex is a DeepSeek Harness plugin that exposes two Codex-style model tools:

- exec_command: start a shell command and collect its initial output.
- write_stdin: send input to, or poll, a previously started command session.

The implementation is TypeScript-first, Windows-first, and structured so that the process backend can support Windows, macOS, and Linux without changing the model-facing tool contract.

The plugin is intentionally independent of DHS's current terminal-bash PTY path. That path currently depends on terminal inspection that is unavailable on Windows. The plugin must instead use an internal backend abstraction, with a PTY implementation based on a cross-platform PTY library and a pipe implementation as a fallback.

## 2. Goals

### Required goals

1. Provide Codex-compatible exec_command and write_stdin names and lifecycle semantics.
2. Use TypeScript and publish a normal ESM DHS plugin package.
3. Run on Windows first, with a backend boundary for macOS and Linux.
4. Use a PTY by default for interactive behavior.
5. Preserve long-running processes between tool calls.
6. Prevent sessions from being accessed by another agent owner.
7. Bound output memory and report truncation instead of silently losing output.
8. Clean up all live processes when the plugin, owner, or DHS context is disposed.
9. Keep shell selection and security policy out of the model-visible schema.

### Non-goals for v1

1. Reimplement the full Codex approval or sandbox protocol.
2. Expose terminal_open, terminal_send, or the other DHS terminal tools.
3. Add a public resize or terminate tool.
4. Guarantee that a command written for PowerShell is portable to POSIX shells, or vice versa.
5. Modify the DeepSeek Harness core packages.

## 3. Public tool contract

### 3.1 exec_command

The model-visible parameters are:

~~~ts
interface ExecCommandArgs {
  cmd: string
  workdir?: string
  yield_time_ms?: number
  max_output_tokens?: number
}
~~~

cmd is required. The following are deliberately not model-visible:

- shell
- login
- sandbox_permissions
- justification
- prefix_rule
- tty

PTY is the default transport in v1. The backend may internally fall back to pipes when PTY creation is unavailable or when the configured policy requires it.

Defaults:

| Setting | Default |
| --- | ---: |
| yield_time_ms | 10_000 |
| max_output_tokens | configured limit, normally 10_000 |
| PTY rows | 24 |
| PTY columns | 80 |

The command runs in a new process session. A persistent shell is not reused between separate exec_command calls.

### 3.2 write_stdin

The model-visible parameters are:

~~~ts
interface WriteStdinArgs {
  session_id: number
  chars?: string
  yield_time_ms?: number
  max_output_tokens?: number
}
~~~

Defaults and behavior:

- chars defaults to an empty string.
- Empty chars means poll; it does not write an empty payload.
- Non-empty chars is written as UTF-8 data to the PTY or pipe.
- yield_time_ms defaults to 250 for an interactive write.
- Polls must use a bounded wait and wake on output or process exit.
- Control-C, represented by U+0003, is passed through for PTY sessions.
- A completed or unknown session returns a structured tool error.

The implementation must serialize writes and polls for an individual session. Different sessions may be serviced concurrently.

### 3.3 Result shape

Both tools return the same canonical JSON shape:

~~~ts
interface ExecCommandResult {
  output: string
  wall_time_seconds: number
  session_id?: number
  exit_code?: number
  chunk_id?: string
  original_token_count?: number
  truncated?: boolean
}
~~~

Rules:

- output is always present and may be empty.
- session_id is present only while the process is still running.
- exit_code is present once the process has exited.
- wall_time_seconds measures the current tool operation, not the full lifetime of a session.
- chunk_id is optional and may identify an output segment.
- original_token_count is emitted only when an exact token counter is available.
- truncated must be true when returned output is incomplete because of a configured limit.
- Model-visible output strips ANSI/VT terminal control sequences, including CSI
  and terminal-title controls, while preserving printable text, line endings,
  Unicode, and interactive PTY input behavior.

## 4. DHS integration

The plugin entry point must follow the DHS Cordis plugin shape:

~~~ts
export const name = 'bash-codex'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: Context): void {
  // Register the session service and both model-facing tools.
}
~~~

The exact DHS tool registration must use defineTool() and ctx.tools.register(). Each tool must:

1. Validate its arguments through the tool schema.
2. Use exec.signal for cancellation.
3. Return one canonical JSON value.
4. Throw infrastructure failures rather than encoding them as successful output.
5. Register cleanup through the Cordis effect/disposal lifecycle.

The plugin may add a short system-prompt capability note describing the host shell, for example that Windows commands use PowerShell and POSIX commands use the resolved POSIX shell.

The plugin must be loadable from a compiled absolute module path in a Cordis configuration entry:

~~~yaml
- insert:
    - id: bash-codex
      name: 'C:\path\to\dsh-plugins\bash-codex\lib\index.js'
~~~

## 5. Package layout

~~~text
bash-codex/
├── package.json
├── tsconfig.json
├── README.md
├── SPEC.md
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── tools/
│   │   ├── exec-command.ts
│   │   └── write-stdin.ts
│   ├── session/
│   │   ├── exec-session-service.ts
│   │   ├── session-registry.ts
│   │   ├── output-log.ts
│   │   └── lifecycle.ts
│   ├── backend/
│   │   ├── session-backend.ts
│   │   ├── pty-backend.ts
│   │   ├── pipe-backend.ts
│   │   └── node-pty-backend.ts
│   ├── shell/
│   │   ├── shell-adapter.ts
│   │   ├── windows-powershell.ts
│   │   └── posix-shell.ts
│   ├── output/
│   │   ├── output-limiter.ts
│   │   └── text-decoder.ts
│   └── policy/
│       └── execution-policy.ts
└── test/
    ├── tools.test.ts
    ├── session-lifecycle.test.ts
    ├── output.test.ts
    ├── windows.integration.test.ts
    └── cross-platform.integration.test.ts
~~~

Platform-specific behavior must stay in backend/ and shell/. Tool files must not contain process.platform branches or direct child_process/PTY calls.

## 6. Session service

The session service is the central internal API used by both tools:

~~~ts
interface ExecSessionService {
  exec(request: ExecRequest): Promise<ExecResult>
  write(request: WriteRequest): Promise<ExecResult>
  closeOwner(owner: SessionOwner): Promise<void>
  dispose(): Promise<void>
}
~~~

Each session record must contain:

~~~ts
interface SessionRecord {
  id: number
  owner: SessionOwner
  backend: SessionBackend
  output: OutputLog
  state: 'starting' | 'running' | 'exited' | 'terminating' | 'closed'
  activeOperation?: Promise<unknown>
  exit?: ExitStatus
  startedAt: number
}
~~~

Session rules:

1. Reserve the numeric ID before spawning.
2. Publish the record only after backend setup succeeds.
3. Roll back the record if spawning fails.
4. Validate owner identity on every write operation.
5. Serialize operations for one session.
6. Keep completed output available long enough to return the final result, then remove the session.
7. Terminate all live sessions during plugin disposal.
8. Limit active sessions through configuration; the default target is 64.

The public session ID is an opaque plugin identifier. It must not be treated as an operating-system PID, even if the backend also exposes a PID internally.

## 7. Backend abstraction

The session service must depend on this platform-neutral interface:

~~~ts
interface SessionBackend {
  readonly transport: 'pty' | 'pipe'
  readonly pid?: number
  write(data: Uint8Array): Promise<void>
  closeStdin(): Promise<void>
  interrupt(): Promise<void>
  terminate(): Promise<void>
  waitForExit(): Promise<ExitStatus>
  waitForQuiescence(): Promise<void>
}
~~~

### PTY backend

The PTY backend is the default:

- Windows: ConPTY through the selected PTY library.
- macOS/Linux: native POSIX PTY through the same adapter.
- PTY output is a single merged stream.
- Default size is 80 columns by 24 rows.
- PTY creation failure may use the configured pipe fallback.

### Pipe backend

The pipe backend is an internal fallback:

- Use child_process.spawn() with explicit argv.
- Do not use Node exec() or implicit shell interpolation.
- Keep stdout and stderr separately until the result renderer combines them.
- Support delayed stdin writes.
- Use bounded output collection.

The fallback policy must be explicit in configuration:

~~~ts
type PtyFallback = 'pipe' | 'error'
~~~

## 8. Shell adapter

The shell adapter is responsible for resolving an executable and constructing arguments. Shell configuration is plugin configuration, not model input.

~~~ts
interface ShellAdapter {
  resolve(): Promise<ResolvedShell>
  oneShotArgs(command: string): readonly string[]
  interactiveArgs(): readonly string[]
}
~~~

Recommended resolution:

### Windows

1. Configured executable.
2. pwsh.exe.
3. Windows PowerShell 5.1.
4. cmd.exe only as an explicit compatibility fallback.

### macOS/Linux

1. Configured executable.
2. SHELL.
3. /bin/zsh on macOS.
4. /bin/bash.
5. /bin/sh.

The adapter must pass the command as one shell-specific argument and must not concatenate untrusted arguments into a command line.

## 9. Output handling

Each session owns an append-only output log. Reads are cursor-based internally and are non-consuming from the backend.

~~~ts
interface OutputLog {
  append(stream: OutputStream, bytes: Uint8Array): void
  read(cursor: number, limit: OutputLimit): OutputRead
  waitForChange(cursor: number, signal: AbortSignal): Promise<void>
}
~~~

Requirements:

- Decode bytes with a streaming TextDecoder.
- Preserve output across multiple polls.
- Return explicit truncation metadata.
- Enforce a hard byte ceiling in addition to max_output_tokens.
- Drain output briefly after root process exit.
- Distinguish root exit, process-tree termination, and output drain completion.

The initial implementation may use a bounded in-memory head/tail buffer. A spill-to-disk implementation is optional and must not be required for the first Windows release.

## 10. Cancellation and termination

Cancellation from exec.signal must stop a pending tool operation and terminate the associated process session when appropriate.

The backend must distinguish:

- closeStdin(): send EOF only.
- interrupt(): request foreground interruption, normally Control-C.
- terminate(): terminate the complete process tree.

Windows v1 may use taskkill /PID <pid> /T /F as the process-tree fallback. The backend interface must leave room for a stronger Windows Job Object implementation later. POSIX implementations should use detached process groups and group-level termination.

Termination must be idempotent and safe when the process has already exited.

## 11. Security policy

Approval and sandbox parameters must not be accepted from the model.

The plugin must instead use a deployment-level execution policy:

~~~ts
type ExecutionMode = 'trusted' | 'host-policy'
~~~

- trusted: intended for local development and explicitly trusted profiles.
- host-policy: delegates command confinement to a DHS-compatible policy adapter.

The default production configuration should require an explicit policy choice rather than silently granting broad host access.

The policy boundary must be independent of the tool schemas so that security behavior can change without changing the model contract.

## 12. Configuration

All operational limits belong in plugin configuration rather than hidden constants:

~~~ts
interface Config {
  executionMode: 'trusted' | 'host-policy'
  ptyFallback: 'pipe' | 'error'
  maxSessions: number
  defaultYieldTimeMs: number
  pollYieldTimeMs: number
  maxOutputBytes: number
  defaultMaxOutputTokens: number
  rows: number
  cols: number
  windowsPtyStartupGraceMs?: number
  windowsShell?: string
  posixShell?: string
}
~~~

Suggested development defaults:

~~~ts
{
  executionMode: 'trusted',
  ptyFallback: 'pipe',
  maxSessions: 64,
  defaultYieldTimeMs: 10_000,
  pollYieldTimeMs: 250,
  maxOutputBytes: 1_048_576,
  defaultMaxOutputTokens: 10_000,
  rows: 24,
  cols: 80,
  windowsPtyStartupGraceMs: 2_000
}
~~~

## 13. Testing requirements

### Unit tests

- Tool schemas expose only the approved public parameters.
- Missing cmd and missing session_id are rejected.
- Empty chars performs a poll.
- Session IDs are unique within an owner.
- A different owner cannot write to a session.
- Concurrent operations on one session are serialized.
- Output truncation is reported.
- Cancellation is propagated.
- Disposal terminates all live sessions.

### Windows integration tests

- Run a short PowerShell command and return exit_code.
- Run a long-lived Node or PowerShell process and return session_id.
- Send input through write_stdin.
- Poll with empty chars.
- Send Control-C to a PTY process.
- Use a custom workdir.
- Preserve Unicode output.
- Exercise PTY failure and pipe fallback.
- Verify process-tree cleanup after termination.

Tests should use Node-based fixtures where possible so they are not coupled to Unix commands such as ls, bash, or sleep.

### DHS integration test

Load the compiled plugin in a minimal DHS profile and verify:

1. Both tools appear in the tool schema list.
2. exec_command can be called by an agent.
3. A live session can be polled with write_stdin.
4. Plugin disposal leaves no live child process.

## 14. Definition of done

The first implementation is complete when:

1. bash-codex builds from TypeScript to lib/.
2. DHS can load the compiled plugin through an absolute Cordis entry.
3. Windows supports the complete exec_command to write_stdin lifecycle.
4. PTY is the default transport and pipe fallback is configurable.
5. Session ownership, output limits, cancellation, and cleanup are tested.
6. macOS/Linux backend boundaries compile cleanly, even if their integration tests run later.
7. No model-visible parameter implements shell selection or approval bypass.
