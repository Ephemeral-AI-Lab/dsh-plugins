# workflow-ui

`workflow-ui` is a browser-only DeepSeek Harness plugin that presents the
durable workflow records already written to the parent Session by
`@deepseek-ai/dsh-tool-workflow`.

It registers through the `dsh.client` package contract and contributes a
root-scoped `shell.overlay` workspace. The workspace has a run navigator and
selected-run detail view for phases, child agents, logs, structured results,
terminal errors, and child Session navigation. Structured results and tool
errors are read from DHS's typed tool Conversation projection; the current
workflow event contract does not include durable phase/log records, so the
dashboard shows its empty-log state until those events exist.

Execution, model/provider selection, cancellation ownership, and persistence
remain in DHS. The existing inline `workflow-run` Conversation Node remains
untouched; this plugin registers a parallel dashboard-only Definition over the
same durable run/member events.
