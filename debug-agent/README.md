# DSH debug-agent

This is an external Cordis plugin. It registers the internal per-turn provider
route `mock-debug` / `debug` and routes accepted `/debug run` and `/debug replay`
commands through the public AgentLoop request waterfall. The route is
deliberately omitted from the advertised model catalog, so the normal model
selector remains unchanged; only the slash command activates it. The plugin
also registers `debug` in the public slash-command catalog, and its command
handler queues the exact line as a normal AgentLoop follow-up. The adapter
emits ordinary model chunks; the host AgentLoop and ToolRuntime execute and
record the actual calls.

Replay is read-only and in-memory. A relative path is resolved against the
current session's absolute `session.header.cwd`; when that value is missing,
relative paths are rejected. Absolute paths are accepted for read-only input,
and the plugin never creates, copies, rewrites, renames, or deletes a replay
source. `--overwrite-wait-time-ms` changes only explicit waits in the detached
canonical plan.

The plugin emits ephemeral `debug/status` events for a host UI bridge. The
bridge should render a compact status row above the existing composer and
leave normal DSH tool/result/error cards authoritative.
