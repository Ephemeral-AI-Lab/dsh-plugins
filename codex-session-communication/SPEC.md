# Codex Session Communication for DeepSeek Harness

Status: proposed v1

This plugin adds Codex-style cross-session communication tools to DeepSeek Harness (DSH) without modifying DeepSeek Harness source code.

The plugin is a standalone Cordis extension. It adapts DSH's existing agent, session, event, persistence, and tool-registration APIs into a small task-oriented interface.

## Goals

The plugin must:

- create a new DSH session with an initial prompt;
- send later messages to an existing session;
- wait for state or durable-event changes across one or more sessions;
- read a session's durable event log incrementally;
- list session metadata without starting sessions;
- behave similarly to Codex's create_thread, send_message_to_thread, wait_threads, read_thread, and list_threads operations;
- remain entirely outside the deepseek-harness source tree;
- use existing DSH public extension points and services;
- return promptly for asynchronous operations rather than pretending to return model completion results.

## Non-goals

The v1 plugin does not provide:

- changes to DeepSeek Harness source code;
- a second persistence database or session registry;
- arbitrary model, provider, workspace, or agent-construction options;
- a public transport request_id;
- retry deduplication or idempotent message submission;
- session deletion or retention management;
- transcript search or filtering DSLs;
- multimodal message content;
- automatic resumption of cold sessions during listing or waiting;
- a promise that identifies the final model response for one individual message.

## Installation boundary

All implementation files belong under:

~~~text
/Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/codex-session-communication
~~~

The plugin may be enabled from a DSH/Cordis composition file, for example:

~~~yaml
- name: '/Users/yifanxu/Ephemeral-AI-Lab/dsh-plugins/codex-session-communication'
~~~

The exact composition also needs the normal DSH providers for agents, tools, sessions, LLMs, and persistence. Enabling this plugin is configuration; it is not a modification to deepseek-harness implementation code.

## Codex compatibility model

The compatibility is semantic rather than a byte-for-byte copy of Codex's internal wire protocol.

| Plugin concept | Codex concept | DSH concept |
| --- | --- | --- |
| session_id | thread/task ID | SessionId / agent session |
| create_session | create_thread | ctx.agents.create(...) plus initial followup(...) |
| send_message_to_session | send_message_to_thread | Agent.followup(...) |
| wait_sessions | wait_threads | session/event and agent/status observation |
| read_session | read_thread | ctx.sessionPersistence.readFrom(...) |
| list_sessions | list_threads | ctx.sessionPersistence.list(...) plus live status |
| after_seq | afterCursor | DSH event sequence watermark |

Codex-specific fields such as hostId, worktree targets, and thinking configuration are intentionally not exposed by this plugin.

## Public tools

The plugin registers exactly these five tools:

~~~text
create_session
send_message_to_session
wait_sessions
read_session
list_sessions
~~~

The spelling is wait_sessions; wait_sessons is not part of the public API.

### create_session

Creates a session and queues its initial prompt.

#### Parameters

~~~json
{
  "prompt": "string, required, non-empty"
}
~~~

#### Result

~~~json
{
  "session_id": "string"
}
~~~

#### Semantics

The operation:

1. generates a new opaque session ID;
2. creates a DSH agent/session for that ID;
3. converts prompt into a DSH user message;
4. queues that message with agent.followup(...);
5. returns after the session and initial message have been accepted.

The result does not mean that model generation has finished. The caller must use wait_sessions and read_session to observe progress and output.

If session creation succeeds but initial message submission fails, the plugin must dispose the newly created handle and return an error. It must not leave an unusable partially-created session owned by the plugin.

The plugin uses the DSH composition's configured model and provider. It does not expose arbitrary agentOptions in v1.

### send_message_to_session

Queues a text message for an existing session.

#### Parameters

~~~json
{
  "session_id": "string, required, non-empty",
  "message": "string, required, non-empty"
}
~~~

#### Result

~~~json
{
  "message_id": "string"
}
~~~

#### Semantics

The plugin resolves the session as follows:

1. use the live agent if it is currently registered;
2. otherwise resume the persisted session through the existing DSH agent/session APIs;
3. create a DSH user message;
4. call agent.followup(...);
5. return the durable message identity.

message_id means that DSH accepted the message into the session inbox. It does not identify a completed model response.

Agent.followup(...) does not provide a per-message completion promise. The plugin must not wait for whole-agent idle inside this tool or attach a later response to this message by guessing from the last assistant event.

### wait_sessions

Waits for durable-event or meaningful state changes in one or more sessions.

#### Parameters

~~~json
{
  "session_ids": ["string, required, non-empty"],
  "after": {
    "session-id": "integer, optional, last sequence already observed"
  },
  "timeout_ms": "integer, optional, non-negative and bounded"
}
~~~

The after object is keyed by session ID. Missing entries mean that the caller has no prior cursor for that session and should be treated as -1.

#### Result

~~~json
{
  "sessions": [
    {
      "session_id": "string",
      "status": "running | idle | cold | missing | error",
      "last_seq": "integer",
      "changed": "boolean"
    }
  ],
  "timed_out": "boolean"
}
~~~

#### Semantics

- timeout_ms: 0 returns an immediate snapshot;
- a positive timeout waits until at least one selected session has a new durable event or meaningful status transition;
- the result contains a snapshot for every requested session, not only the session that changed;
- a normal timeout returns timed_out: true; it is not a tool error;
- waiting must not resume a cold session merely to inspect it;
- a missing session may be represented with status: missing; the tool must not silently create one;
- the plugin must use event/status observation, not a busy polling loop;
- the plugin must not treat Agent.whenIdle() as completion for one specific follow-up. DSH idle is whole-agent quiescence and may cover multiple queued messages.

The implementation should subscribe to the existing session/event and agent/status events, establish the listener before its final snapshot check, and always dispose the listener and timeout in every completion path.

### read_session

Reads a durable suffix of a session event log.

#### Parameters

~~~json
{
  "session_id": "string, required, non-empty",
  "after_seq": "integer, optional, default -1",
  "limit": "integer, optional, positive"
}
~~~

#### Result

~~~json
{
  "events": ["SessionEvent"],
  "next_seq": "integer",
  "has_more": "boolean"
}
~~~

#### Semantics

The public parameter after_seq is exclusive:

~~~text
after_seq = -1  -> return events beginning at seq 0
after_seq = 4   -> return events beginning at seq 5
~~~

The implementation maps this to DSH persistence's inclusive readFrom API:

~~~text
fromSeq = after_seq + 1
~~~

The plugin must read from ctx.sessionPersistence.readFrom(...). It must not resume or start an agent just to read a persisted session.

next_seq is a continuation cursor. It is the first sequence number the caller should request on the next read:

~~~text
next_seq = last returned event.seq + 1
~~~

If no events are returned:

~~~text
next_seq = after_seq + 1
~~~

Examples:

| Stored events | Request | Returned events | next_seq | has_more |
| --- | --- | --- | ---: | --- |
| empty | after_seq: -1 | none | 0 | false |
| 0, 1, 2 | after_seq: -1 | 0, 1, 2 | 3 | false |
| 0, 1, 2 | after_seq: 1 | 2 | 3 | false |
| 0..9 | after_seq: -1, limit: 3 | 0, 1, 2 | 3 | true |
| 0..9 | after_seq: 4, limit: 2 | 5, 6 | 7 | true |

Therefore next_seq is not always the session's maximum sequence plus one. It equals the maximum sequence plus one only when the read reaches the current end of the session. When limit truncates the result, it points to the first unread event.

DSH uses zero-based event sequences. An empty session's last sequence is -1; its first possible event sequence is 0.

The event stream is authoritative. The plugin must not infer a response by selecting the last assistant message after a send.

### list_sessions

Lists session metadata without loading or resuming sessions.

#### Parameters

~~~json
{
  "limit": "integer, optional, positive"
}
~~~

#### Result

~~~json
{
  "sessions": [
    {
      "session_id": "string",
      "status": "running | idle | cold",
      "updated_at": "string"
    }
  ]
}
~~~

#### Semantics

- read stored metadata from ctx.sessionPersistence.list();
- join live status from existing DSH agent/session registries when available;
- never load a complete event log for listing;
- never resume a cold session;
- never start model work;
- apply limit after obtaining metadata;
- do not add pagination cursors until the underlying list requires them.

## Identifier policy

The v1 public API intentionally has no request_id.

The identifiers have distinct responsibilities:

| Identifier | Owner | Purpose |
| --- | --- | --- |
| transport request ID | JSON-RPC/tool transport | Correlates transport requests internally |
| session_id | plugin/DSH | Identifies the conversation/session |
| message_id | DSH message layer | Identifies accepted inbox work |
| event seq | DSH session log | Identifies durable progress |

An optional caller-owned request_id would only be valid if the plugin persisted it and enforced deduplication. Without that behavior, exposing it would imply retry safety that does not exist.

If retry-safe message submission becomes necessary later, add an explicitly documented persisted idempotency_key to send_message_to_session. That is out of scope for v1.

## DSH integration contract

The plugin may depend on these existing services and APIs:

~~~text
ctx.tools.register(...)
ctx.agents.create(...)
ctx.agents.get(...)
ctx.agents.resume(...) or the existing equivalent
AgentHandle.dispose()
Agent.followup(...)
createUserMessage(...)
ctx.sessionPersistence.readFrom(...)
ctx.sessionPersistence.list(...)
ctx.on('session/event', ...)
ctx.on('agent/status', ...)
~~~

The plugin must not:

- import private DSH implementation modules;
- patch or fork the agent loop;
- write directly to DSH persistence backends;
- maintain a competing session log;
- change DSH's built-in tool or event schemas;
- modify files under deepseek-harness.

If an implementation requirement cannot be satisfied using existing public APIs, stop and document the missing capability rather than modifying the harness as an implicit workaround.

## Proposed implementation layout

~~~text
src/index.ts
  Cordis entrypoint, injection list, tool registration, cleanup

src/types.ts
  tool argument/result types and small public projections

src/session-communication.ts
  session creation/resolution, message enqueueing, event-driven waiting,
  durable reads, metadata listing, and lifecycle cleanup

src/tools.ts
  five defineTool() registrations; each delegates to the service
~~~

The implementation should not add a custom SessionRegistry. DSH's ctx.agents, ctx.sessions, and ctx.sessionPersistence already provide the necessary live and durable state.

## Testing and acceptance criteria

The plugin is acceptable when the following checks pass without changing deepseek-harness.

### Registration

- the plugin loads through a Cordis composition;
- all five tools are registered exactly once;
- plugin disposal unregisters the tools and disposes plugin-owned resources;
- tool schemas reject missing or empty required strings;
- wait_sessions rejects an empty session_ids array;
- numeric limits and timeouts reject invalid values.

### Creation and messaging

- create_session({ prompt }) returns a new session ID;
- the initial prompt is durably accepted;
- send_message_to_session returns a message ID;
- sending to a live session queues the message;
- sending to a cold persisted session resumes it through public DSH APIs;
- sending to a missing session returns an error and does not create it implicitly.

### Waiting

- timeout_ms: 0 returns immediately;
- a positive wait wakes on a selected session event;
- a positive wait wakes on a meaningful selected-session status transition;
- an ordinary timeout returns timed_out: true;
- waiting on a cold session does not resume it;
- listeners and timers are cleaned up after success, timeout, abort, and error.

### Cursor correctness

- empty logs use last_seq: -1 and next_seq: 0;
- after_seq is exclusive;
- next_seq is one greater than the last returned event;
- a limited read resumes without skipping or duplicating events;
- has_more is true only when unread events remain after the returned page;
- a read does not start or resume an agent.

### Listing

- list_sessions includes persisted cold sessions;
- live status is reported when available;
- listing does not resume sessions or start model work;
- listing does not read complete transcripts.

### Harness boundary

- no files under deepseek-harness are modified;
- the plugin uses only documented/public DSH extension points;
- the plugin can be enabled or disabled through composition configuration.

## Future extensions

Only add these after a concrete requirement appears:

- structured or multimodal message content;
- a caller-owned persisted idempotency_key;
- initial session configuration such as model or cwd;
- pagination for list_sessions;
- message-aware wait boundaries;
- session cancellation or disposal tools;
- transcript projection helpers that return only user/assistant messages.
