# dsh-loop v2 specification

Status: design specification.

This document defines the cross-session loop system discussed for Cordis. It
supersedes the ownership and persistence assumptions in `SPEC.md` for v2, but
does not change the v1 contract until the implementation migration is
complete.

## 1. Product model

V2 merges recurring alarms and cron jobs into one concept: a **loop**. A loop
stores a prompt, a schedule, and a target session. The scheduler is owned by
the DSH profile, not by an individual live agent. This allows a loop to wake a
cold session and allows one global automation panel to manage loops across
sessions.

There are only three agent tools:

- `loop_create`
- `loop_list`
- `loop_delete`

There is no separate cron tool, global/local mode parameter, model-effort
parameter, pause tool, update tool, or run-now tool in v2.

The local composer and the global automation panel are views over the same
durable registry:

```text
                         durable loop registry
                         /                  \
          local composer status       global automation panel
          current-session view         all-session management view
```

## 2. Public API

### 2.1 `loop_create`

```ts
loop_create({
  prompt: string,
  schedule:
    | { kind: "every", every_seconds: number }
    | { kind: "after", after_seconds: number }
    | { kind: "cron", expr: string, tz?: string },
  session_id?: "self" | "new" | string,
  preset?: string,
  time_in_seconds?: number, // deprecated v1 compatibility alias
}) -> LoopView
```

`schedule` is the canonical API. `time_in_seconds` is accepted only for
backward compatibility when `schedule` is omitted; it maps to
`{ kind: "every", every_seconds: time_in_seconds }`. Supplying both is an
input error.

The duration fields are always seconds. Cron expressions use cron syntax and
`tz`, when supplied, is an IANA time-zone name such as `Asia/Shanghai`.

#### Session target options

| Input | Meaning |
| --- | --- |
| omitted | The current local session that invoked the tool. |
| `"self"` | The stable global interface session. This is an execution target, not a list scope. |
| `"new"` | Create a fresh isolated session for every loop execution. |
| actual session ID | Resume and deliver to that specific session. |

`"self"` is a user-facing alias. The host may use a different concrete ID
internally for the global interface session. If that interface is unavailable,
creation targeting `self` fails clearly rather than silently targeting the
current local session.

For `after`, `new` creates one fresh session when the loop fires. For `every`
and `cron`, each occurrence creates a fresh session. A loop targeting an
actual session reuses that session across occurrences.

#### Preset and model inheritance

`preset` is optional and is valid only when `session_id` is `"new"`. Presets
can only be mounted while starting a new session.

- Current-session target: inherit the current session preset and model.
- `self`: inherit the global interface session preset and model.
- Existing session ID: inherit that session's persisted preset and model,
  including when it must be resumed from cold storage.
- `new`: use the supplied preset, or inherit the creator/global source preset
  when omitted. Model configuration is always inherited; there is no public
  `model_effort` field.

The loop record never stores a user-supplied model or reasoning-effort value.
If the inherited source is unavailable, the host uses the profile default and
records the fallback in the run error/status metadata.

### 2.2 `loop_list`

```ts
loop_list({
  session_id?: "global" | string,
}) -> LoopView[]
```

The argument is optional:

| Input | Meaning |
| --- | --- |
| `{}` | List active loops targeting the current local session. |
| `{ session_id: "global" }` | List all loops in the DSH profile. |
| `{ session_id: "abc123" }` | List active loops targeting one exact session. |

`"global"` is a list selector only. It is not an execution target. The
execution target for the global interface is `"self"` in `loop_create`.

The global list is available to the global automation panel. The local
composer uses the empty-argument form and must not display unrelated loops.

### 2.3 `loop_delete`

```ts
loop_delete({
  loop_id: string,
}) -> { deleted: true, loop_id: string }
```

Loop IDs are globally unique within the DSH profile. A caller may delete any
loop by ID; `session_id` is not required and ownership checks do not block
global automation management.

Unknown IDs are input errors. Deletion is idempotent only at the UI layer:
the first successful call removes the loop; a later call for the same ID
returns an unknown-loop error.

## 3. Schedule semantics

```ts
type LoopSchedule =
  | { kind: "every", every_seconds: number }
  | { kind: "after", after_seconds: number }
  | { kind: "cron", expr: string, tz?: string }
```

- `every`: recurring interval. The first occurrence is scheduled relative to
  creation time.
- `after`: one occurrence after the specified number of seconds. After a
  successful delivery, the loop is completed and no longer appears in the
  active list.
- `cron`: recurring wall-clock schedule evaluated in `tz`, or the host
  timezone when omitted.

All duration values must be positive safe integers. Cron expressions and
time-zones are validated during creation. A cron loop must have a calculable
future occurrence.

Missed occurrences use an anti-burst policy: after recovery, the scheduler
delivers at most one occurrence and advances to the next future occurrence.
It does not replay every missed interval.

## 4. Loop record and result shape

```ts
interface LoopView {
  loop_id: string
  prompt: string
  schedule: LoopSchedule
  session_id: "self" | "new" | string
  created_by_session_id: string
  created_at: number
  next_at?: number
  last_run_at?: number
  last_result?: "delivered" | "failed"
  last_error?: string
  state: "scheduled" | "running" | "overdue" | "completed" | "failed"
}
```

The active list normally contains `scheduled`, `running`, `overdue`, and
retryable `failed` records. Completed `after` loops are retained in run
history but omitted from the active list.

The UI may derive countdown text from `next_at` and the current clock. It must
not derive scheduler state by replaying raw event history.

## 5. Persistence and scheduler ownership

V2 uses a host-owned durable loop registry backed by the DSH profile's storage
domain. The registry is the source of truth for loop definitions, next-run
state, and run outcomes. It is not stored only in a live agent's session event
log.

The scheduler is started once per DSH profile and is independent of whether
any target agent is currently live. It must:

1. load active loops on profile startup;
2. calculate the earliest due loop;
3. use a one-shot timer with safe delay clamping;
4. serialize dispatch and registry updates;
5. recover loops after process restart;
6. avoid duplicate dispatch if multiple scheduler instances observe the same
   profile.

For a target session ID, the scheduler sends through the normal DSH inbox. If
the target is cold, it resumes the session first, with no preset override and
no model override. For `new`, it creates an isolated session, mounts the
selected/inherited preset at creation time, and sends the prompt there.

The durable sequence for a successful occurrence is:

```text
claim occurrence
  -> resolve target session
  -> create/resume target agent
  -> deliver normal user message with wakeup
  -> record run result
  -> advance next occurrence or complete after-loop
```

The claim and final state update must be recoverable. A crash before a
successful delivery may retry. A crash after delivery but before recording the
result may produce a duplicate; v2 should use a durable occurrence key where
the DSH inbox supports idempotency, but exactly-once model execution is not a
contract.

## 6. Delivery message

Each occurrence is delivered as a normal DSH user message containing loop
metadata:

```xml
<loop>
  <loop_id>loop_abc123</loop_id>
  <prompt>Check the deployment status</prompt>
</loop>
```

The scheduler uses the public DSH agent/inbox APIs. It must not call private
model-driver methods. For a live target, delivery uses the same adaptive inbox
behavior as v1: idle targets use `next-turn`; running targets use the next
safe step boundary. The message is delivered with wakeup enabled.

## 7. `dsh-sessions` companion plugin

The separate `dsh-sessions` plugin at `dsh-plugins/sessions` provides session discovery for
the global panel and for selecting an existing `session_id`.

It provides two read-only tools:

```ts
list_sessions({
  limit?: number,
}) -> { sessions: SessionView[] }

check_session_status({
  session_id: string,
}) -> SessionStatusView
```

The result merges persisted session headers with currently live agents, so it
includes both cold and live sessions:

```ts
interface SessionView {
  session_id: string
  title?: string
  status: "running" | "idle" | "cold"
  updated_at: string
}
```

`list_sessions` is read-only. It does not create, resume, delete, or mutate a
session. It reads the latest durable title through the built-in
`ctx.sessionQuery.readTitleSnapshots()` seam and never calls
`ctx.sessionTitle.refresh()` or starts an LLM request. Loop creation may
validate an exact session ID against this service before accepting it.

Title resolution follows the durable event fold:

```text
user-renamed title
  -> LLM-generated title
  -> deterministic first-prompt fallback
  -> session_id display fallback
```

The final `session_id` fallback is a consumer display rule, not a generated or
persisted title.

`check_session_status` is the targeted form for one exact session. It returns
`running`, `idle`, `cold`, or `missing` and never resumes a cold session.

## 8. UI contract

### 8.1 Local composer status

The existing small loop status in the local message composer remains. It is a
compact current-session view backed by `loop_list({})` or the equivalent host
projection. It may show:

- active loop count;
- the nearest next run;
- a compact overdue/failed indicator;
- a link or action to inspect the local loops.

It must not show other sessions' loops and must not become a second scheduler.

### 8.2 Global automation panel

The global panel is the management surface for all profile loops. It uses
`loop_list({ session_id: "global" })`, `loop_create`, and `loop_delete`.
Session selection is populated by `list_sessions`. The picker displays the
returned title and uses the stable `session_id` when `title` is absent.

Each row should expose:

- prompt preview;
- schedule;
- target (`self`, `new`, or a concrete session ID);
- current state;
- next run;
- last run and last error;
- delete action.

Creation controls should offer:

- current local session;
- global interface (`self`);
- fresh session (`new`);
- an existing session selected from `list_sessions`;
- optional preset only when `new` is selected.

The panel does not expose model-effort or model-selection controls. There is
no separate persisted `mode: local | global`; visibility is derived from the
list query and execution target.

## 9. Validation and reserved values

Reserved session selector values are exact, case-sensitive strings:

- `self`: create target for the global interface;
- `new`: create target for fresh sessions;
- `global`: list-all selector only.

An actual session may not use one of these reserved IDs. `preset` with omitted,
`self`, or an actual session ID is rejected. `preset` with `new` is accepted
only if the preset exists and can be mounted for a new session.

Prompts are non-empty strings and are trimmed before persistence. Loop IDs,
session IDs, and preset IDs must be non-empty strings. All tool inputs reject
unknown properties so the three-tool contract stays unambiguous.

## 10. V1 compatibility and migration

V1 session-local loops remain readable during migration. The v2 adapter should
either import active v1 loop records into the global registry or run a clearly
defined compatibility runtime, but must not silently create two active copies
of one loop.

The compatibility mapping is:

```ts
{ prompt, time_in_seconds }
  -> {
       prompt,
       schedule: { kind: "every", every_seconds: time_in_seconds },
       session_id: currentSessionId,
     }
```

New code emits the v2 `schedule` shape and `loop_id` field. The old
`loop_delete({ id })` form may remain temporarily as a deprecated alias, but
the canonical form is `loop_delete({ loop_id })`.

The unfinished `dsh-plugins/cronjob` package is not part of the v2 runtime.
Cron support is implemented by `dsh-loop` so every schedule type shares the
same registry, tools, UI, and session-targeting behavior.

## 11. Implementation phases

1. Reuse or implement the session-discovery adapter with `list_sessions` and
   durable session titles.
2. Add the durable profile loop registry and one scheduler instance.
3. Add v2 schedule validation and target resolution to `dsh-loop`.
4. Add current-session and cross-session delivery, including cold resume.
5. Replace the local projection source with the registry-backed local status.
6. Build the global automation panel using the three loop tools and
   `list_sessions`.
7. Add v1 migration/compatibility tests and remove the standalone cronjob
   implementation after migration is verified.

## 12. Acceptance tests

- `every`, `after`, and `cron` accept only their documented fields.
- Every duration uses seconds and rejects zero, negative, fractional, and
  unsafe values.
- `after` executes once and disappears from the active list after success.
- `every` and `cron` recover after process restart without burst replay.
- Omitted `session_id` targets the current session.
- `self` targets the stable global interface.
- `new` creates a fresh session for each occurrence.
- An actual session ID resumes and reuses that session.
- Explicit presets are accepted only for `new`.
- Existing/self/current targets inherit preset and model configuration.
- No public model-effort or model-selection field is accepted.
- `loop_list({})`, `loop_list({ session_id: "global" })`, and exact-session
  filtering return the expected sets.
- Any loop can be deleted by globally unique `loop_id`.
- `list_sessions` returns both live and cold sessions.
- `list_sessions` returns durable titles without triggering title generation.
- The local composer shows only current-session loop status.
- The global panel can discover sessions, create targeted loops, list all
  loops, and delete any loop.
