# DSH Sidechat specification

Status: proposed v1.

This document is the normative design for the `dsh-sidechat` plugin under
`dsh-plugins/sidechat`. The words MUST, MUST NOT, SHOULD, and SHOULD NOT define
requirements and defaults.

Sidechat is a temporary, user-operated conversation that reads an immutable
snapshot of the conversation currently displayed in the center pane. It is not
a DSH Session, Agent, Subagent, fork, worktree, or persisted transcript.

## 1. Product contract

The plugin MUST provide a right-side chat surface with these properties:

1. A newly opened sidechat is visually empty.
2. It inherits a read-only snapshot of the exact centered conversation.
3. When the centered page is a subagent, the sidechat anchors to that subagent,
   not to its main/root session.
4. Only the user can submit follow-up or steer input.
5. The sidechat cannot modify or message any DSH Agent or Session.
6. DSH Agents cannot discover or address the sidechat through session or
   subagent APIs.
7. Sidechat state exists only in process memory and browser module memory.
8. Manual tab close, idle collection, plugin unload, or program restart removes
   the sidechat.
9. No sidechat content is written to JSONL, SQLite, browser storage, or another
   durable store.

The fixed architecture is:

```text
centered DSH conversation
        |
        | one read-only snapshot
        v
in-memory SideChatState
        |
        | direct ctx.llm.stream()
        v
sidechat UI only
```

There is no message-delivery edge between this state and an Agent inbox.

## 2. Explicit non-goals

V1 MUST NOT:

- call `ctx.sessions.create()`;
- call `ctx.agents.create()` or `ctx.agents.resume()`;
- call `ctx.subagents.start()` or `ctx.subagents.startContinuable()`;
- register a model-facing sidechat tool;
- expose a `SessionId` or `subagent_id` for the sidechat;
- append an event to the centered session;
- create a sidechat JSONL file;
- appear in `session_status`, `session.list`, `list_agents`, the workspace tree,
  the subagent catalog, or session lineage;
- inherit the centered Agent's tools or message-delivery capabilities;
- create or use a Git worktree;
- synchronize centered-session changes automatically;
- survive DSH process restart.

Full DSH tool execution is out of scope. If a future sidechat must edit files,
run shell commands, or use AgentLoop tools, that is a separate ephemeral-agent
capability and must not be implemented by silently turning this sidechat into a
continuable subagent.

## 3. Identity and authority

Sidechat uses its own branded identifier, unrelated to `SessionId`:

```ts
export type SideChatId = string & {
  readonly __sideChatId: unique symbol
}
```

Every sidechat also has a high-entropy capability held only by the browser and
the Host's in-memory record:

```ts
interface SideChatAddress {
  sideChatId: SideChatId
  capability: string
}
```

The Host SHOULD mint both values with cryptographically secure randomness. The
capability MUST contain at least 256 random bits and MUST be required by every
operation after `open`.

There MUST be no endpoint that lists sidechats. A `SideChatId` without its
capability grants no access. Neither value may be included in:

- an Agent prompt;
- an Agent tool result;
- a DSH session event;
- logs at ordinary information/debug levels;
- localStorage, sessionStorage, or IndexedDB.

The capability protects an existing user sidechat from accidental or guessed
local access. It is not a security boundary against a hostile process running
with unrestricted access as the same operating-system user.

## 4. Centered-conversation anchor

### 4.1 Selecting the anchor

The browser MUST pass the exact `sessionId` owned by the currently rendered
conversation component when opening a sidechat.

```text
centered main session     -> main session id
centered fork             -> fork session id
centered subagent         -> child subagent session id
```

The client MUST NOT walk from a child to its main/root ancestor. An existing
sidechat retains the anchor captured at creation even when the user navigates
the center pane. Creating another tab captures the newly centered session.

### 4.2 Reading the anchor

The Host resolves the anchor without resuming an Agent:

1. use the live Session when it is already in `ctx.sessions`;
2. otherwise inspect the cold session through
   `ctx.sessionPersistence.inspect(sessionId)`;
3. return `anchor-not-found` if neither source contains it.

The read MUST NOT call `load()` when that would perform durable recovery and
MUST NOT activate a cold Agent.

### 4.3 Stable message boundary

The anchor snapshot includes only the event prefix through the latest completed
`step/end`. This prevents an in-flight assistant stream, unresolved tool call,
or partial tool result from entering the sidechat request.

Conceptually:

```ts
const boundary = events.findLast(event => event.type === 'step/end')
const prefix = boundary === undefined ? [] : events.slice(0, boundary.seq + 1)
const surface = foldSurface(prefix)
const messages = surface.nodes
  .map(seq => deriveEventMessage(prefix[seq]!))
  .filter(message => message !== null)
```

The implementation MUST reuse DSH's exported `foldSurface()` and
`deriveEventMessage()` functions. It MUST NOT maintain a second event-to-message
parser.

When no completed step exists, the anchor contains no inherited messages but
may still contain metadata and a resolved model route.

### 4.4 Anchor shape

```ts
interface SideChatAnchor {
  sessionId: SessionId
  kind: 'main' | 'fork' | 'subagent'
  title?: string
  cwd?: string
  agentPreset?: string
  capturedAt: number
  capturedThroughSeq: number
  messages: readonly Message[]
  model: {
    provider: string
    model: string
    reasoningEffort?: string
  }
}
```

`messages` MUST be an immutable snapshot. Later writes to the centered Session
must not change an existing anchor.

`title`, `cwd`, and `agentPreset` are informational. They grant no filesystem,
Agent, or tool authority.

### 4.5 Explicit refresh

The user MAY refresh an existing sidechat's anchor. Refresh repeats the capture
against the same `anchor.sessionId`, replaces only the anchor snapshot, and
preserves the sidechat's private transcript.

Automatic event-by-event synchronization is forbidden in v1.

## 5. Model-route resolution

The sidechat inherits the centered conversation's provider/model route, but not
its Agent composition.

Resolution order is:

1. the latest `request/header` config in the centered session;
2. the live centered Agent's provider/model options when no request header
   exists;
3. the deployment default model;
4. `model-unavailable` when none is available.

The plugin may inherit an explicitly selected reasoning effort. It MUST NOT
inherit:

- tool schemas;
- the centered Agent's `sessionId` request routing;
- Agent scope;
- inbox state;
- delegation depth;
- subagent continuation/report tools;
- approval or worktree capabilities.

## 6. Prompt construction

Sidechat calls the LLM service directly. It MUST NOT invoke AgentLoop.

```ts
ctx.llm.stream({
  provider: anchor.model.provider,
  model: anchor.model.model,
  ...anchor.model.reasoningEffort === undefined
    ? {}
    : { reasoningEffort: anchor.model.reasoningEffort },
  system: SIDECHAT_SYSTEM_PROMPT,
  messages: [
    ...anchor.messages,
    readOnlyBoundaryMessage(anchor),
    ...sideChatTranscript,
    currentUserMessage,
  ],
  signal,
})
```

The request MUST omit both `tools` and `sessionId`.

The fixed system prompt MUST clearly state that:

- the preceding centered conversation is immutable reference context;
- the sidechat may explain, summarize, compare, and reason about it;
- the sidechat cannot modify files, sessions, Agents, or runtime state;
- the sidechat cannot send messages to Agents;
- no tools are available;
- a requested mutation must be described for the user to perform in the
  centered conversation, not claimed as completed.

The centered Agent's full system prompt MUST NOT be copied. It may contain tool,
editing, delegation, or approval instructions that are false for sidechat.

The read-only boundary message identifies the anchor and separates inherited
messages from the private sidechat conversation. Neither inherited messages
nor the boundary message appears in the sidechat transcript UI.

## 7. In-memory state

```ts
interface SideChatState {
  id: SideChatId
  capability: string
  anchor: SideChatAnchor
  transcript: SideChatMessage[]
  pending: SideChatInput[]
  active?: SideChatRun
  createdAt: number
  lastAccessedAt: number
}

interface SideChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

interface SideChatInput {
  id: string
  delivery: 'followup' | 'steer'
  content: ContentBlock[]
}

interface SideChatRun {
  inputId: string
  controller: AbortController
  partial: ContentBlock[]
  startedAt: number
}
```

The Host owns one process-local `Map<SideChatId, SideChatState>`. Only one model
stream may be active for a sidechat.

The visible client store is a cache/projection. The Host map is authoritative
for lifecycle and generation while the process is running.

## 8. User input semantics

### 8.1 Follow-up

A follow-up means "run this as the next sidechat turn."

- When idle, append the user message and start generation immediately.
- When running, enqueue it FIFO and run it after the current response settles.
- A follow-up never changes or interrupts the current response.

### 8.2 Steer

A steer means "replace the direction of the current response."

When running:

1. abort the active LLM stream;
2. expose any partial assistant output as `interrupted` presentation state;
3. exclude that partial output from future model history;
4. append the user's steer input;
5. start a replacement generation immediately.

When idle, steer behaves like an immediate follow-up.

When several steer inputs race, the newest unstarted steer supersedes older
unstarted steers. Accepted follow-ups retain FIFO order.

### 8.3 Stop

Stop aborts the current stream and returns the sidechat to idle without adding
another user message. Partial output remains visible as interrupted but is not
added to the model transcript.

### 8.4 Close

Close aborts the active stream, rejects/removes queued input, clears all
transcript and anchor references, and deletes the map entry. Later operations
return `sidechat-not-found`.

## 9. Lifecycle and memory recycling

Sidechat data MUST remain memory-only.

The following events destroy state:

| Event | Required behavior |
| --- | --- |
| Sidechat tab close | Abort and delete immediately. |
| Idle timeout | Delete after 30 minutes without activity. |
| Plugin unload/HMR | Abort every run and clear the complete map. |
| DSH process exit/restart | State disappears with the process. |
| Lost browser without close | Idle timeout eventually deletes the orphan. |

One process-wide sweep SHOULD run once per minute. A sidechat with an active
stream MUST NOT expire. `lastAccessedAt` updates on submit, steer, stop,
snapshot, and anchor refresh.

Collapsing the Workbench panel hides a sidechat but does not delete it. The tab
`×` is the manual destruction action.

The browser MUST keep tab order, active tab, addresses, and rendered messages
in module memory only. A browser reload starts with no sidechat tabs.

## 10. Host/client transport

V1 SHOULD reuse the generic DSH client connection instead of owning another
WebSocket protocol:

```ts
ctx.connection.rpc.handle(
  '/sidechat',
  handleSideChatRpc,
  { authority: 'loopback' },
)
```

The channel exposes these endpoints:

```text
open
submit
snapshot
refresh
stop
close
```

### 10.1 `open`

```ts
open({
  anchorSessionId: string,
}) -> {
  sideChatId: string,
  capability: string,
  anchor: SideChatAnchorSummary,
}
```

### 10.2 `submit`

```ts
submit({
  sideChatId: string,
  capability: string,
  content: ContentBlock[],
  delivery: 'followup' | 'steer',
}) -> {
  messageId: string,
  accepted: true,
}
```

Submission returns after admission, not after model completion.

### 10.3 `snapshot`

```ts
snapshot({
  sideChatId: string,
  capability: string,
}) -> {
  status: 'idle' | 'running' | 'error',
  messages: SideChatMessageView[],
  partialAssistant?: SideChatInterruptedOrStreamingView,
  queuedCount: number,
  anchor: SideChatAnchorSummary,
}
```

The browser polls snapshots only while the panel is visible and the sidechat is
running. A 250-500 ms interval is sufficient for the local v1. It stops polling
when the sidechat becomes idle, errors, closes, or the panel hides.

Push streaming may replace snapshot polling later without changing the
SideChat state model or user-input semantics.

### 10.4 `refresh`, `stop`, and `close`

Each requires the complete address. `refresh` returns the new anchor summary;
`stop` acknowledges the abort request; `close` returns `{ closed: true }`.

## 11. UI contract

The client MUST reuse `dsh-workbench-ui` and register one Workbench item:

```ts
workbench.register({
  id: 'sidechat',
  label: 'Side chat',
  component: SideChatPanel,
})
```

The sidechat plugin does not register a second details-column shell.

The panel contains:

- one tab per in-memory sidechat;
- a `+` button that opens a new empty tab anchored to the currently centered
  session;
- a tab `×` that closes and destroys that sidechat;
- an anchor summary and explicit Refresh action;
- a conversation body containing only private sidechat messages;
- a composer with Send/Follow-up, Steer, and Stop behavior;
- an empty state explaining that the chat is temporary and read-only.

Suggested empty state:

```text
Side chat

Read-only context: <centered session title>
Captured just now

This chat is temporary and disappears when closed or DSH restarts.
```

Changing the centered conversation MUST NOT re-anchor an existing tab. Pressing
`+` after navigation creates a new tab against the new center.

The UI MUST distinguish:

- queued follow-up input;
- actively streaming output;
- interrupted partial output;
- error state;
- expired/not-found state.

Buttons and tabs MUST be keyboard accessible and expose visible focus states.

## 12. Isolation invariants

For every sidechat operation:

- the count and content of DSH session logs remain unchanged;
- the Agent registry gains no entry;
- the Session store gains no entry;
- the subagent catalog gains no entry;
- workspace membership remains unchanged;
- no Agent inbox receives a message;
- no `subagent/start`, `subagent/end`, report, settlement, or coordinator event
  is produced;
- no model-visible tool schema exposes sidechat;
- sidechat output is delivered only through its client projection.

The sidechat generation routine receives detached anchor/model data. It MUST
NOT receive a centered `Agent` handle or a service object capable of delivering
messages.

## 13. Validation and errors

All RPC payloads reject unknown properties and validate bounded strings and
arrays before touching state.

Stable error codes are:

| Code | Meaning |
| --- | --- |
| `bad-request` | Invalid shape, empty input, or unsupported content. |
| `anchor-not-found` | The centered session cannot be inspected. |
| `anchor-unavailable` | The centered session exists but its stable snapshot cannot be read. |
| `model-unavailable` | No usable provider/model route can be resolved. |
| `sidechat-not-found` | The chat was closed, expired, or belongs to an earlier process. |
| `sidechat-forbidden` | The capability does not match. |
| `sidechat-busy` | An operation conflicts with current state and cannot be queued. |
| `generation-failed` | The LLM stream ended with a provider/runtime error. |

Error messages MUST NOT include capabilities, raw request headers, credentials,
or full inherited conversation content.

## 14. Package boundary

The implementation belongs in:

```text
dsh-plugins/sidechat/
├── README.md
├── SPEC.md
├── package.json
├── cordis.patch.yml
├── tsconfig.json
├── tsconfig.client.json
├── tsdown.config.ts
├── src/
│   ├── index.ts
│   ├── service.ts
│   ├── context.ts
│   ├── types.ts
│   └── client/
│       ├── index.ts
│       ├── SideChatPanel.tsx
│       ├── SideChatPanel.module.css
│       └── store.ts
└── test/
    ├── service.test.ts
    ├── context.test.ts
    └── client.test.tsx
```

The Host half may depend on public LLM, Session inspection/projection, default
model, and client-connection services. It MUST NOT depend on the subagent
runtime.

The client half may depend on the DSH client runtime/UI primitives and
`dsh-workbench-ui/client`.

No change to the read-only `deepseek-harness` checkout is part of this plugin.

## 15. Acceptance tests

The plugin is ready only when all of the following pass:

- Opening on a main session captures that exact session ID.
- Opening on a fork captures that exact fork ID.
- Opening on a subagent page captures that exact child ID.
- A new sidechat's visible transcript is empty.
- Its first model request contains the stable centered-session messages.
- The request uses the centered route and a sidechat-only system prompt.
- The request contains neither `tools` nor `sessionId`.
- Opening, prompting, steering, refreshing, stopping, and closing append zero
  events to every DSH Session.
- No sidechat appears in the Agent registry, Session store, workspace list,
  subagent catalog, `session_status`, or `list_agents`.
- A follow-up submitted while idle starts immediately.
- A follow-up submitted while running waits FIFO for the next turn.
- A steer aborts the current stream and starts replacement generation.
- Interrupted partial output remains visible but is absent from the next model
  request.
- Stop aborts without adding a new user message.
- Refresh replaces anchor messages while preserving private sidechat messages.
- Navigating the centered conversation does not re-anchor an existing tab.
- Creating a tab after navigation anchors to the new center.
- A wrong capability is rejected without revealing whether an ID exists.
- Closing a tab aborts its run and makes later access return not found.
- Idle collection deletes inactive chats after the TTL.
- Plugin unload aborts every run and clears all state.
- A restarted Host contains no prior sidechat state.
- No sidechat identifier or capability is written to durable storage.

## 16. Deferred work

The following require a separate explicit decision and are not v1 placeholders:

- push/SSE/WebSocket delivery instead of active-only snapshot polling;
- file, shell, web, MCP, or other tool execution;
- durable sidechat restoration;
- automatic live context synchronization;
- sharing a sidechat between browser clients;
- exporting a sidechat into a real DSH Session;
- hostile same-user process isolation.

V1 should remain a small in-memory LLM conversation with a frozen read-only DSH
conversation anchor.
