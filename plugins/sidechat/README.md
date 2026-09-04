# dsh-sidechat

Memory-only, user-operated side chats for DeepSeek Harness. A sidechat receives
a frozen read-only snapshot of the exact conversation in the center pane and
uses that conversation's effective provider/model route.

The centered preset ID is retained as informational metadata only. Its system
prompt, tools, and Agent composition are not inherited; sidechat always uses a
small tool-free, read-only system prompt.

Sidechat does not create a DSH Session, Agent, Subagent, fork, worktree, or
JSONL record. It calls the LLM service directly with no tools and no session
identity. Closing a tab, idle collection, plugin unload, or DSH restart removes
its state.

## Install locally

Install `dsh-workbench-ui` first, then this package:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-plugins/work-bench-ui
dsh plugin --profile web add /absolute/path/to/dsh-plugins/sidechat
```

Restart Web and refresh the browser after building client code.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

See [SPEC.md](./SPEC.md) for the complete lifecycle, isolation, context, and UI
contract.
