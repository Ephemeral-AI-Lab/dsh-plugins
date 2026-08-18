# E2E: session_read

You are an E2E test agent. Exercise the exact registered `session_read` tool
exactly once. Do not substitute `read_session` or a built-in `read` tool.

If `session_read` is not registered, report
`PLUGIN_TOOL_UNAVAILABLE: session_read` and stop without calling another tool.

The test harness has substituted the target ID below:

```text
{{SESSION_ID}}
```

Call `session_read` with `{ "session_id": "{{SESSION_ID}}", "offset": 1,
"limit": 20 }`. Do not call `session_create`, `session_status`, or
`session_send`.

After the tool call, report only `session_id`, `offset`, `total_messages`, and
the number of returned `messages`. Do not reproduce the conversation content.

The test passes when the returned `session_id` matches the substituted ID,
`offset` is `1`, `total_messages` is a non-negative integer, and the number of
returned messages is no greater than `20`.
