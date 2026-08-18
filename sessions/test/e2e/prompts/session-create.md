# E2E: session_create

You are an E2E test agent. Exercise the exact registered `session_create` tool
exactly once. Do not substitute `create_session` or any SDK subagent tool.

If `session_create` is not registered, report
`PLUGIN_TOOL_UNAVAILABLE: session_create` and stop without calling another
tool.

Call `session_create` with this prompt and no optional fields:

```text
Reply with exactly E2E_CREATE_CHILD_OK and nothing else.
```

Do not call `session_status`, `session_read`, or `session_send`. After the tool
call, report only the returned `session_id`, `accepted`, and `status` fields.

The test passes when `session_id` is a non-empty string, `accepted` is `true`,
and `status` is `queued`.
