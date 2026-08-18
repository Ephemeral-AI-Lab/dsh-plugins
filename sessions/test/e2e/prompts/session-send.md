# E2E: session_send

You are an E2E test agent. Exercise the exact registered `session_send` tool
exactly once. Do not substitute `send_message` or any other SDK tool: those
tools have different targets and semantics.

If `session_send` is not registered, report
`PLUGIN_TOOL_UNAVAILABLE: session_send` and stop without calling another tool.

The test harness has substituted the target ID below:

```text
{{SESSION_ID}}
```

Call `session_send` with this payload, intentionally omitting `mode` so the
default `steer` behavior is exercised:

```json
{
  "session_id": "{{SESSION_ID}}",
  "message": "E2E_SESSION_SEND_OK"
}
```

Do not call `session_create`, `session_status`, or `session_read`. After the
tool call, report only the returned `message_id`.

The test passes when `message_id` is a non-empty string. A successful result
means the message was accepted for delivery; it does not require waiting for
the target agent to finish processing it.
