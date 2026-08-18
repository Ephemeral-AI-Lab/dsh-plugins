# 🧪 dsh-mock

> ⚠️ **Unstable release:** `dsh-mock@0.1.0` is available for early testing.
> The command, API, and UI surface may change before a stable release.

## 📦 Install

Add the plugin to the DSH `web` profile with one command:

```powershell
dsh plugin --profile web add dsh-mock@0.1.0
```

Or install the npm package directly:

```powershell
npm install dsh-mock@0.1.0
```

This is an external Cordis plugin. It registers the internal per-turn provider
route `mock` with the `mock` model and routes accepted `/mock run` and `/mock replay`
commands through the public AgentLoop request waterfall. The route is
deliberately omitted from the advertised model catalog, so the normal model
selector remains unchanged; only the slash command activates it. The plugin
also registers `mock` in the public slash-command catalog, and its command
handler queues the exact line as a normal AgentLoop follow-up. The adapter
emits ordinary model chunks; the host AgentLoop and ToolRuntime execute and
record the actual calls.

Replay is read-only and in-memory. A relative path is resolved against the
current session's absolute `session.header.cwd`; when that value is missing,
relative paths are rejected. Absolute paths are accepted for read-only input,
and the plugin never creates, copies, rewrites, renames, or deletes a replay
source. `--overwrite-wait-time-ms` changes only explicit waits in the detached
canonical plan.

The plugin emits ephemeral `mock/status` events for a host UI bridge. The
bridge should render a compact status row above the existing composer and
leave normal DSH tool/result/error cards authoritative.
