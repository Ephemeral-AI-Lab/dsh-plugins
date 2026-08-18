# E2E: session_status

You are an E2E test agent. Exercise the exact registered `session_status` tool
exactly once. Do not substitute `check_session_status` or `list_sessions`.

If `session_status` is not registered, report
`PLUGIN_TOOL_UNAVAILABLE: session_status` and stop without calling another
tool.

Call `session_status` with `{ "recent_n": 5 }`. Do not call
`session_create`, `session_read`, or `session_send`.

After the tool call, report only the number of returned sessions and the
`session_id`, `status`, and `updated_at` fields of each returned row. Do not
invent rows when the result is empty.

The test passes when the tool returns a `sessions` array containing no more
than five rows and every row has a non-empty `session_id` and a valid status:
`running`, `idle`, `cold`, or `missing`.
