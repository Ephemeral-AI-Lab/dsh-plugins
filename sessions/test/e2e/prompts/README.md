# Session-tool E2E prompts

These prompts are intentionally narrow: each one asks an agent to exercise one
public `dsh-sessions` tool and report a small, machine-checkable result.

The E2E composition must load `dsh-sessions` into the target agent's tool
registry. The names in these prompts are exact public tool names, not loose
aliases.

Recommended order:

1. Run `session-create.md` and capture the returned `session_id`.
2. Substitute that value for `{{SESSION_ID}}` in the other prompts.
3. Run `session-status.md` and use the returned `session_path` with ordinary
   filesystem tools when conversation inspection is needed.

The E2E harness should replace `{{SESSION_ID}}` before sending a prompt. The
agent should not use another session tool to satisfy a prompt unless the prompt
explicitly asks for it.

If an exact tool is not registered, the harness setup is incomplete. The agent
should report `PLUGIN_TOOL_UNAVAILABLE: <tool name>` and stop; it should not
substitute an SDK or legacy tool name.
