# DSH mock exhaustive test specification

Status: test-plan authoring document for the multi-step mock/replay contract.
The system under test is the external DSH plugin in
C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\mock.

This document specifies tests; it does not authorize changes to
deepseek-harness or to any file other than this document. The implementation
must continue to use the normal DSH AgentLoop and ToolRuntime. The mock
adapter produces model output and queue timing; it must never execute a tool
implementation directly or reimplement tool validation, policy, approval,
durable-event, or output-validation behavior.

The UI state and rendering contract exercised by the UI/E2E cases is defined
in [ui/ui-ux.md](ui/ui-ux.md).

The detailed backend matrix for areas 1–8 is indexed in
[test-matrix/README.md](test-matrix/README.md).

The matrix audit, edge-case additions, estimates, and fast replay-fixture
plan are summarized in [test-matrix/review-summary.md](test-matrix/review-summary.md).

## 1. Test levels, fixtures, and invariants

### 1.1 Test levels

| Level | Harness | Purpose | Allowed dependencies |
| --- | --- | --- | --- |
| U: unit | Pure parser, validator, converter, queue compiler, and stream fixtures | Exact input/output and negative-case coverage without a DSH process | Fake clock, fake stream, in-memory filesystem |
| I: integration | Real DSH LlmRuntime, AgentLoop, ToolRuntime, SessionStore, policy/approval and event persistence | Prove that canonical steps cross the public adapter boundary and use real runtime semantics | In-memory tools and deterministic test providers only |
| E: E2E/browser | Compiled external plugin loaded by a DSH profile and the web client | Prove profile loading, persistence, UI state, command routing, reload, and concurrent sessions | Built plugin, host profile, Playwright/browser scaffold |

Every behavior below has at least one U and I test where the behavior is
runtime-affecting. UI-only behavior is E. A test is not complete until it
asserts both the positive result and the absence of the forbidden shortcut
(direct execution, source mutation, premature completion, or state leakage).

### 1.2 Required fixtures

Use deterministic names so event and queue assertions are readable:

- probe_tool({value}): records every invocation, arguments, session id, and
  cancellation signal; returns a valid object {ok: true, value}.
- ordered_tool({label, delayMs?}): records start and finish order; uses a
  fake clock when delay is requested.
- needs_value({value: string}): requires value; rejects wrong types and
  disallowed extra properties through the real ToolRuntime schema.
- throws_tool({message}): throws a controlled execution error.
- bad_output({}): has an output schema and returns a deliberately invalid
  value.
- approval_tool({}): is covered by the host policy/approval path and can
  produce allow, deny, or pending approval outcomes.
- background_start({label}): starts a normal background job and returns its
  job id without pretending the job is a scripted child step.
- nested_agent({}): represents a subagent/nested-agent tool. It must exercise
  the explicitly unsupported path rather than silently creating a child replay.
- real_provider_probe: a spy real-provider adapter used only to prove that
  non-slash messages still use the configured real-provider route.
- recordingClock: fake monotonic clock with advance, pending-timer count,
  and elapsed-time inspection.
- recordingSessionStore: real persistence interface backed by a temporary
  in-memory or test directory; records event order and payloads.
- session-A and session-B: concurrent sessions with different scripts, tools,
  and expected results.

Canonical script fixtures:

~~~json
{
  "type": "dsh-mock-script",
  "version": 1,
  "steps": [
    { "tool": "probe_tool", "args": { "value": "one" } },
    { "wait": 250 },
    {
      "parallel": [
        { "tool": "ordered_tool", "args": { "label": "a" } },
        { "tool": "ordered_tool", "args": { "label": "b" } }
      ]
    },
    { "tool": "probe_tool", "args": { "value": "last" } }
  ]
}
~~~

Also keep fixtures for a single step, two sequential steps, two parallel
steps, explicit waits of 0 and 250 ms, a leading wait, a trailing wait, two
consecutive waits, an empty script, and a script containing an invalid tool
step. JSONL fixtures must include LF and CRLF variants and stable seq, time,
turn, and step values.

### 1.3 Observable invariants

1. A valid mock command or replay has one canonical representation before it
   reaches queue compilation.
2. The self-authored path and every DSH-conversion path call the same canonical
   validator. There is no weaker validation for converted input.
3. Tool execution is visible only through the real ToolRuntime. A spy on the
   registered tool must see the call; a spy on the adapter must never see an
   execution call.
4. Historical tool results are input evidence, not replay actions. Conversion
   must not schedule old results or copy them as fresh tool output.
5. A wait is scheduling state, not a tool call. It must not create a tool-call
   event, generic tool spinner, or fake assistant tool-result message.
6. A parallel group has no inter-member gap and does not release the next
   scripted step until all members have reached the defined terminal state.
7. A malformed script fails before the first tool call. A runtime tool failure
   fails fast and skips later scripted steps according to the error policy.
8. Completion means the queue is terminal, including the final model stop and
   durable event. A wait, pending approval, active stream, or unresolved tool
   result is still running.
9. Session state is keyed by session id. No pending call, queue cursor, result,
   timer, approval, or child state can be consumed by another session.
10. Disposing the plugin unregisters its provider and cancels/clears every
    adapter-owned queue, timer, abort listener, and session entry.

## 2. Coverage matrix

The following matrix is the minimum named suite. Parameterize equivalent
fixtures rather than replacing them with one broad happy-path test.

| ID range | Area | U | I | E |
| --- | --- | ---: | ---: | ---: |
| CMD-01..32 | Slash command parsing, replay paths, and diagnostics | yes | command-routing subset | command entry subset |
| SCH-01..25 | Canonical schema and shared validation | yes | first-call rejection | invalid-script UI |
| ADP-01..34 | Format adapters and native DSH JSONL | yes | converted replay execution | file-picker/replay subset |
| Q-01..15 | Queue compilation and wait timing | yes | fake-clock runtime | progress timing subset |
| STR-01..18 | Adapter stream semantics and abort | yes | real loop stream | running/idle subset |
| RT-01..24 | Real AgentLoop/ToolRuntime integration | selected | yes | surfaced error subset |
| SES-01..20 | Interrupts, followup, steer, isolation, cleanup | selected | yes | concurrent-session subset |
| JOB-01..10 | Background jobs and nested agents | selected | yes | job/sidebar subset |
| PER-01..12 | Persistence and source/output safety | yes | yes | reload subset |
| UI-01..16 | Spinner, waits, errors, completion, status | component-level | event bridge | yes |
| E2E-01..12 | Browser/profile smoke and end-to-end journeys | no | profile setup | yes |

## 3. Slash command parsing

The command router must recognize only the mock slash-command forms. The
examples below are normative fixtures for the selected public spelling:

~~~text
/mock run probe_tool({"value":"ok"})
/mock run [probe_tool({"value":"a"}) probe_tool({"value":"b"})]
/mock replay scripts\one.json
/mock replay "C:\test fixtures\one.jsonl" --overwrite-wait-time-ms 250
~~~

The bracket form contains complete `tool_name(JSON_OBJECT)` expressions
separated by whitespace or newlines. The invariant is unchanged: arguments
are JSON only, never JavaScript or shell syntax, and the normalized result is
the canonical script below.

### 3.1 /mock run positive cases

| ID | Input fixture | Expected assertion | Negative guard |
| --- | --- | --- | --- |
| CMD-01 | Single probe_tool with {} | One canonical tool step with empty args | No wait step is synthesized by parsing |
| CMD-02 | Single call with nested objects, arrays, booleans, null, Unicode, escaped quotes, and large safe integers | Parsed args deep-equals JSON parse result | No evaluation or string coercion |
| CMD-03 | Leading/trailing and internal JSON whitespace | Same canonical step as compact JSON | Whitespace is not stored in raw arguments |
| CMD-04 | Bracket form with two tool-call expressions | One canonical parallel step in source order | No sequential steps for siblings |
| CMD-05 | Bracket form with three or more calls | All calls present once, stable order and unique call ids later | No inter-call wait |
| CMD-06 | Parallel calls with empty args and nested JSON | Valid strict tool/args shapes | Array is not treated as one tool argument object |
| CMD-07 | Syntactically valid unknown tool | Accepted by command parser and rejected only by real ToolRuntime later | No registry lookup in parser |
| CMD-08 | Repeated command in two sessions | Each session receives its own script/cursor | No global queue |

### 3.2 JSON-only and malformed inputs

For each negative case assert: deterministic diagnostic, no queue entry, no
tool-call stream block, no ToolRuntime invocation, no durable tool/call or
tool/result event, and a terminal non-busy state.

| ID | Invalid input | Expected rejection |
| --- | --- | --- |
| CMD-09 | Single quotes, comments, unquoted keys, undefined, NaN, or trailing commas | Not JSON; reject |
| CMD-10 | JavaScript expression, function call, template string, arithmetic, or new expression | Reject without evaluation |
| CMD-11 | Missing tool name, empty name, invalid identifier, or embedded command separator | Reject |
| CMD-12 | Missing parentheses/JSON payload, unmatched delimiters, or extra trailing statement | Reject exactly one command only |
| CMD-13 | JSON array, scalar, null, or string where tool args object is required | Reject |
| CMD-14 | Parallel bracket contains malformed or incomplete tool-call expression | Reject |
| CMD-15 | Parallel item is missing tool or args, has a non-object args, or has extra shape fields | Reject through canonical validator |
| CMD-16 | /mock, /mock run, or whitespace-only command | Reject with usage diagnostic |
| CMD-17 | /mock run containing a wait object, wait(...), --wait, sleep, or a timing flag | Reject: run has no wait syntax |
| CMD-18 | Unknown command/subcommand, unsupported option, duplicated option, or shell pipeline/redirection | Reject; do not forward to a tool or shell |

The parser must not interpret a JSON string that happens to contain
/mock, wait, or shell syntax. Only the command tokens and JSON structure
define behavior.

## 4. /mock replay path and option parsing

### 4.1 Path parsing

Use an in-memory filesystem plus real temporary files for both path handling
and persistence tests.

| ID | Fixture | Expected assertion |
| --- | --- | --- |
| CMD-19 | Relative canonical .json path | Resolve relative to the documented session/workspace cwd and load exactly that file |
| CMD-20 | Absolute Windows path with drive letter | Preserve the path and load the requested file |
| CMD-21 | Quoted path containing spaces, parentheses, #, and Unicode | Quotes are removed once; path characters are not tokenized |
| CMD-22 | Forward-slash and backslash separators, . and .. segments | Normalize only for lookup; do not rewrite the source |
| CMD-23 | Native .jsonl file | Select DSH JSONL conversion, then shared canonical validation |
| CMD-24 | Canonical JSON with a misleading extension and supported content | Behavior follows the documented content/format policy and is tested consistently |
| CMD-25 | Missing path, empty path, directory path, unreadable path, and path with no permission | Deterministic file diagnostic; no queue or source mutation |
| CMD-26 | Extra positional path, path after an unexpected token, NUL/newline in path, or unknown option | Reject before reading another path |

### 4.2 --overwrite-wait-time-ms

The option accepts exactly one nonnegative integer in milliseconds. It must
accept 0 and ordinary large safe integers, and reject negative values,
decimals, exponent notation, NaN, Infinity, hex/binary/octal notation, empty
values, missing values, overflow/unsafe integers, duplicated flags, and
unknown wait flags. A numeric-looking string must not be silently rounded.

| ID | Fixture | Expected assertion |
| --- | --- | --- |
| CMD-27 | Replay with no option | Preserve canonical explicit waits |
| CMD-28 | --overwrite-wait-time-ms 0 | Replace every explicit wait with zero; no sleep is scheduled |
| CMD-29 | Option value 250 before or after the path, if both positions are documented | Replace every explicit wait with exactly 250 |
| CMD-30 | Explicit waits separated by tools and parallel groups | Replace waits only; tool args, step order, and parallel membership are unchanged |
| CMD-31 | No explicit waits in source | Do not add explicit waits; implicit queue gaps remain 100 ms |
| CMD-32 | Invalid option values listed above | Reject before conversion/queue creation; source remains byte-identical |

The overwrite applies only to explicit canonical wait steps. It must not
rewrite the compiler's implicit 100 ms gaps, timestamps in the source log,
tool arguments, or waits hidden in invalid nested structures.

## 5. Canonical JSON script and shared validator

### 5.1 Canonical shape

The public canonical representation is strict JSON:

~~~json
{
  "type": "dsh-mock-script",
  "version": 1,
  "steps": [
    { "tool": "tool_name", "args": {} },
    { "wait": 100 },
    { "parallel": [
      { "tool": "tool_a", "args": {} },
      { "tool": "tool_b", "args": { "x": 1 } }
    ] }
  ]
}
~~~

Field names and nesting are normative. If the implementation uses an internal
name such as delay, it must normalize it at the adapter boundary and never
accept both spellings as two public canonical forms. Canonical serialization
must emit one stable spelling.

### 5.2 Validator sharing

| ID | Operation | Expected assertion |
| --- | --- | --- |
| SCH-01 | Validate a self-authored /mock run script | Validator accepts and returns the canonical representation |
| SCH-02 | Convert valid DSH JSONL | Converter calls the same validator before returning/queueing |
| SCH-03 | Feed the same invalid shape through self-authored and converted paths | Both reject with equivalent error category and field context |
| SCH-04 | Spy on validator invocation | Exactly one shared validation boundary precedes queue compilation |
| SCH-05 | Mutate the source object after validation | Queue/canonical output is not changed by caller mutation |
| SCH-06 | Serialize then parse the validator output | Round trip is deep-equal and canonical field order is stable |

The converter must not return a structurally plausible object that bypasses
validation, and the run path must not accept a structure that replay rejects.

### 5.3 Schema positive cases

| ID | Valid fixture | Expected assertion |
| --- | --- | --- |
| SCH-07 | Correct type, version 1, nonempty steps | Accepted |
| SCH-08 | One tool step with empty object args | Accepted |
| SCH-09 | Nested JSON values inside args | Preserved exactly |
| SCH-10 | One top-level wait between executable steps, including wait 0 | Accepted |
| SCH-11 | Nonempty parallel array of valid tool steps | Accepted |
| SCH-12 | Multiple sequential tool and parallel steps | Accepted; original order preserved |
| SCH-13 | Tool names at the public identifier boundary, including hyphen/underscore where allowed | Accepted only when matching the DSH tool-name rule |

### 5.4 Schema negative cases

Every negative case must report the failing path, reject before queue
compilation, and produce no tool call.

| ID | Invalid structure | Expected rejection |
| --- | --- | --- |
| SCH-14 | null, scalar, array, or missing top-level value | Script must be an object |
| SCH-15 | Missing/wrong type, wrong case, or unsupported version | Reject; only dsh-mock-script and version 1 |
| SCH-16 | Missing steps, non-array steps, or empty steps | Reject as empty/invalid script |
| SCH-17 | Step is null, scalar, array, or {} | Reject as invalid step |
| SCH-18 | Tool step missing tool, missing args, invalid tool name, or empty tool name | Reject |
| SCH-19 | Tool args is null, array, scalar, or non-JSON value | Reject; args must be a JSON object |
| SCH-20 | Tool or wait step contains unknown sibling fields | Reject strict shape rather than silently dropping data |
| SCH-21 | Wait is leading, trailing, consecutive, nested inside parallel, or the only step | Reject placement |
| SCH-22 | Wait value is negative, fractional, string, boolean, null, NaN, Infinity, unsafe, or outside integer range | Reject; wait is a nonnegative safe integer |
| SCH-23 | Parallel is empty, contains a wait, contains a nested parallel, or contains malformed tool step | Reject; no waits or nested groups inside parallel |
| SCH-24 | Top-level unknown fields, duplicate JSON keys under the chosen duplicate-key policy, or prototype-pollution keys | Reject or normalize according to an explicit policy; never execute ambiguity |
| SCH-25 | Huge/deep/cyclic in-memory object or parser-produced value that cannot be JSON | Reject safely without hanging or stack overflow |

The placement suite must include valid waits after a tool and after a parallel
group, and invalid waits before the first executable step, after the final
executable step, between two waits, and anywhere in a parallel array.

## 6. Format adapters and native DSH JSONL conversion

### 6.1 Adapter contract

Every accepted input format produces the exact canonical JSON shape and then
uses the shared validator. An adapter must reject a source that claims one
format but contains another format's incompatible structure; it must not
silently drop an invalid tool call or choose a different call merely because
one representation is malformed.

### 6.2 Native JSONL fixtures and grouping

Use records with type, seq, time, data.turn, data.step, and realistic
assistant/tool payloads. Keep a fixture manifest that records expected output.

| ID | Fixture | Expected assertion |
| --- | --- | --- |
| ADP-01 | First nonblank record is a valid session; later blank lines | Blank lines ignored; session header required |
| ADP-02 | One assistant/message with one complete tool-call block | One canonical tool step |
| ADP-03 | One assistant message with sibling calls a, b, c in one turn/step | One parallel step in message/content order |
| ADP-04 | Sibling calls have interleaved tool/call and tool/result records | Sibling grouping remains parallel; historical results are omitted |
| ADP-05 | Calls in different turn/step groups | One sequential canonical step per group in source/sequence order |
| ADP-06 | Same group records arrive out of order but have seq | Sort/group by documented record order without changing content order inside a message |
| ADP-07 | Multiple sequential groups followed by a parallel group and another single | Exact top-level order and membership preserved |
| ADP-08 | assistant/message includes text plus tool calls | Text does not become a tool step or alter call grouping |
| ADP-09 | Historical tool/result has a result that would change a tool arg | Result is not replayed and does not replace the original call |
| ADP-10 | Duplicate historical result for one call id | No duplicate replay step |

### 6.3 Complete, packed, and delta fallback

Test the precedence and fallback policy explicitly:

1. Complete assistant/message tool-call blocks are preferred.
2. If no complete message call exists, complete assistant chunk
   block-end/tool-call records are used.
3. If neither exists, durable tool/call records are used.
4. If durable calls are absent, packed call fragments are assembled.
5. If packed fragments are absent, delta fragments are assembled.
6. A present-but-malformed higher-priority representation is an error; it must
   not be hidden by falling back to lower-priority data.

| ID | Fixture | Expected assertion |
| --- | --- | --- |
| ADP-11 | Complete message plus packed/delta duplicates | Use complete message once |
| ADP-12 | Complete assistant chunk only | Reconstruct one tool step |
| ADP-13 | Durable tool/call only | Reconstruct one tool step; results omitted |
| ADP-14 | Packed fragments for one id in multiple records | Concatenate fragments in record order and parse once |
| ADP-15 | Delta fragments for one id with name and args split | Assemble the complete call and parse once |
| ADP-16 | Several packed/delta ids | Preserve first-seen/order semantics and parallel grouping |
| ADP-17 | Both packed and delta data present with packed valid | Packed representation wins |
| ADP-18 | Packed data present but invalid and delta valid | Reject malformed packed data; no silent delta fallback |
| ADP-19 | Delta missing id/name/final arguments | Reject incomplete call with line context |
| ADP-20 | Complete block appears before its final delta | Prefer complete block and do not duplicate |

### 6.4 Converter negative cases

| ID | Malformed input | Expected assertion |
| --- | --- | --- |
| ADP-21 | Invalid JSON line, scalar line, array line, or malformed text fixture | Reject with 1-based line number |
| ADP-22 | Missing session header, session header not first nonblank record, or wrong header type | Reject before any call |
| ADP-23 | Missing data, nonobject message, nonarray content, or malformed chunk | Reject if the record claims a supported call representation |
| ADP-24 | Tool-call missing name/arguments/id where required | Reject with record/line context |
| ADP-25 | Invalid tool name or raw arguments that are malformed JSON | Reject; never pass raw text to ToolRuntime |
| ADP-26 | Raw args parse to array, scalar, or null | Reject; args must be a JSON object |
| ADP-27 | Missing turn/step on a call record | Follow the documented fallback grouping policy consistently; never accidentally merge unrelated lines |
| ADP-28 | Negative/nonmonotonic sequence or time | Reject or normalize only under an explicit policy; never produce negative waits silently |
| ADP-29 | File is empty or has only a session header | Reject as empty script unless the product explicitly defines a no-op replay |

### 6.5 Timing-to-wait behavior

Conversion must test timing separately from queue defaults. For a source with
two sequential groups, where the first group's terminal source time is 100
and the next group's first call time is 275, the normalized script must contain
an explicit wait of 175 ms between them when timing preservation is enabled.
Equal timestamps produce wait 0; absent timestamps produce no timing-derived
wait; negative elapsed values are rejected or clamped only under the documented
policy and must never become a negative canonical wait.

For sibling calls in one parallel group, timestamps between siblings must not
produce waits. A gap after the whole group may produce one top-level wait.
The --overwrite-wait-time-ms option then replaces that explicit wait, while
the queue compiler still owns implicit gaps.

| ID | Fixture | Expected assertion |
| --- | --- | --- |
| ADP-30 | Sequential groups at 100 then 275 | One explicit 175 ms wait |
| ADP-31 | Sequential groups with equal times | One explicit 0 ms wait; queue execution performs no elapsed delay |
| ADP-32 | Parallel siblings at 100, 150, 200 | No inter-member waits |
| ADP-33 | Missing times | No timing wait; queue default applies later |
| ADP-34 | Negative elapsed/nonmonotonic times | Deterministic reject/clamp policy, covered by validator |

## 7. Persistence and canonical output

### 7.1 Persistence expectations

For a successful run or replay, assert that normal DSH persistence contains
the user command, canonical assistant tool-call messages, tool-call events,
tool-result events, wait/queue lifecycle events if the host exposes them, and
the final assistant stop. The authoritative tool result is the real
ToolRuntime result; a presentation summary must not replace it.

For a malformed script, assert that the diagnostic and terminal error state
are persisted as normal user/assistant or command events according to the host
contract, but no fake tool-call or tool-result event exists. For a runtime tool
failure, preserve the normal error code and durable event payload.

### 7.2 Canonical JSON output

When a canonical script is returned, logged, or written, assert:

- it parses as JSON and validates with the shared validator;
- it contains only type, version, and canonical steps;
- field spelling and field ordering are stable;
- args retain JSON values without stringification or evaluation;
- source timing, historical result content, call ids, and provider-specific
  stream fragments are not accidentally copied into the canonical script;
- parallel order and sequential order are preserved;
- an overwrite operation changes only explicit wait values;
- serialize/parse/serialize is byte-stable under the canonical serializer.

### 7.3 Source safety

Snapshot the source file's bytes, size, last-write marker where reliable, and
hash before replay. After success, validation failure, tool failure, abort,
overwrite, and plugin disposal assert:

- source file is byte-for-byte unchanged;
- source is not deleted, truncated, renamed, or rewritten in place;
- source permissions and sibling files are unchanged;
- no historical result is appended to the source;
- temporary files are cleaned up without deleting an existing unrelated file.

#### Unresolved output-path policy

The destination policy for a newly written canonical output/converted script is
not resolved by this test plan. Mark tests that depend on the destination as
BLOCKED-ON-POLICY, and do not assume in-place replacement, a sidecar suffix,
workspace root output, or an automatically generated temporary path.

Until the policy is decided, required assertions are limited to canonical
in-memory output, source immutability, no unintended deletion, and a test
injection point for the eventual destination. Once decided, add a positive
destination test and collision/overwrite/cleanup tests without weakening the
source-safety assertions.

## 8. Queue compilation

The queue compiler consumes validated canonical steps and produces executable
stream turns. It is tested with the recording clock and a queue observer that
records wait-start, wait-end, tool-start, tool-end, group completion, abort,
and terminal completion.

| ID | Script/option | Expected assertion |
| --- | --- | --- |
| Q-01 | One tool | No leading/trailing wait; one tool call |
| Q-02 | Two sequential tools with no explicit wait | Exactly one implicit 100 ms gap |
| Q-03 | Three sequential tools | Exactly two 100 ms gaps, in order |
| Q-04 | Explicit wait 250 between two tools | One 250 ms gap, not 250+100 and not 100 |
| Q-05 | Explicit wait 0 | No elapsed delay and no generic wait spinner |
| Q-06 | Explicit waits mixed with omitted gaps | Explicit values at explicit positions; all omitted gaps are 100 ms |
| Q-07 | Single parallel group | All members start without an inter-member gap |
| Q-08 | Parallel group followed by a tool | Next tool waits only for group completion and its inter-step gap |
| Q-09 | Tool, parallel group, tool | Correct order; no calls from the final step before the group is terminal |
| Q-10 | Multiple parallel groups | Each group is independent; no cross-group member interleaving |
| Q-11 | Parallel members with different completion times | Group completion waits for all required results, not the first result |
| Q-12 | --overwrite-wait-time-ms 50 | Only explicit waits become 50; implicit gaps stay 100 |
| Q-13 | Overwrite value 0 | Explicit waits disappear without changing queue membership |
| Q-14 | Invalid wait would reach compiler through a mocked validator bypass | Compiler fails closed; no timer with negative/fractional duration |
| Q-15 | Abort during implicit or explicit wait | Timer is cancelled, later calls are skipped, queue ends aborted, and no timer leaks |

Order assertions must use both invocation order and durable event order. A
parallel group's members may finish in a different order, but their start
membership and the next-step barrier must be deterministic and documented.

## 9. Adapter stream semantics

The adapter stream fixture must cover complete blocks, multiple calls,
out-of-order tool results, an active stream, and an abort signal. Delta chunks
are a converter-input concern, not an output requirement for the mock adapter.

| ID | Stream case | Expected assertion |
| --- | --- | --- |
| STR-01 | One complete tool-call block | Emit normal block-start/block-end and finish(kind=tool-calls) |
| STR-02 | One complete call with full JSON arguments | No tool-call-delta chunks are emitted; the block-end contains the full call |
| STR-03 | Multiple calls in one parallel response | All block ids unique; all block ends precede tool-call finish |
| STR-04 | Multiple sequential scripted responses | Next response is emitted only after the previous step's required results and wait |
| STR-05 | Repeated request for the same scripted step | Emit one call per queue item; no duplicate execution |
| STR-06 | Tool result with known call id | Correlates to the correct scripted call and session |
| STR-07 | Tool results arrive out of order for parallel calls | Each result maps by id; next step waits for all |
| STR-08 | Unknown/mismatched result id | Deterministic protocol error; do not consume another pending call |
| STR-09 | Result for a different session | Ignore/reject for that session; other session cursor unchanged |
| STR-10 | Final result at queue end | Emit the final scripted response and stop only at queue end |
| STR-11 | Result after a nonterminal stream chunk | Keep stream/agent active; do not emit final stop early |
| STR-12 | Explicit wait while stream/agent remains active | Wait is visible to queue state, but not a tool call; final stop waits for timer and next response |
| STR-13 | Abort before first chunk | Aborted finish, no call, no pending state |
| STR-14 | Abort between block start and block end | No fabricated complete call; cleanup is idempotent |
| STR-15 | Abort during explicit/implicit wait | Cancel timer and signal; no later stream response |
| STR-16 | Dispose while stream active | Stream settles, listeners/timers clear, provider unregisters |
| STR-17 | Missing session id | Reject clearly or use request-local state; never use a shared fallback session |

The adapter may emit a short text summary after a tool result, but tests must
assert that summary is presentation only. The durable tool result and normal
ToolRuntime error remain authoritative.

## 10. Real AgentLoop and ToolRuntime integration

Boot the smallest real DSH composition with the public APIs:
LlmRuntime, SessionStore, SystemPrompt if required, ToolRuntime, AgentRegistry,
AgentLoop, and the compiled or source mock plugin. Register the fixtures with
the public tool-definition API. Do not replace the loop with a test fake.

| ID | Scenario | Expected assertions |
| --- | --- | --- |
| RT-01 | Valid single probe_tool call | Tool executes once with exact args; assistant call, tool/call, tool/result, and final assistant response persist |
| RT-02 | Valid sequential script | Each step executes once in queue order; later step begins only after prior result |
| RT-03 | Valid parallel script | All members execute through ToolRuntime; no inter-member wait; next step waits for all |
| RT-04 | Unknown tool | Adapter still emits call; ToolRuntime emits normal unknown-tool code; no fixture executes |
| RT-05 | Missing required args | Normal invalid-args code; execute function not called |
| RT-06 | Wrong JSON arg type | Normal invalid-args code; no duplicate adapter validation |
| RT-07 | Disallowed extra property | Normal schema error; no tool execution |
| RT-08 | Tool throws controlled error | Normal execution error is durable and surfaced without adapter rewriting |
| RT-09 | Invalid tool output | Normal invalid-output path; result is marked/error-coded by ToolRuntime |
| RT-10 | Policy allows | Existing policy path allows and records the decision |
| RT-11 | Policy denies | Existing policy/approval failure is preserved; adapter cannot approve itself |
| RT-12 | Approval remains pending | Agent remains running/pending; no next scripted step or final stop |
| RT-13 | Approval then allow | Same call resumes once; no duplicate call |
| RT-14 | Approval then deny | Fail-fast result; later steps skipped |
| RT-15 | Abort while tool executes | Real tool signal is aborted; stream and agent settle; no later steps execute |
| RT-16 | Abort after tool result before next step | Cursor and timers clean; later step is not replayed accidentally on next user turn |
| RT-17 | Durable event inspection | Event order and call ids correlate; historical results are not re-executed |
| RT-18 | Runtime failure on first step of multi-step script | Fail fast; later sequential and parallel steps are marked skipped/not started |
| RT-19 | One member fails in a parallel group | Apply documented group error policy: sibling cancellation/settlement is deterministic, group fails, and later steps do not start |
| RT-20 | Tool output is large/Unicode/empty | Durable content remains valid and summary does not replace it |
| RT-21 | Registered tool has a name valid to parser but hidden by visibility | Real visibility failure, not parser acceptance or direct invocation |
| RT-22 | Tool implementation attempts direct nested execution | Boundary test proves only ToolRuntime path is used |
| RT-23 | Plugin loaded from built lib/index.js | Same behavior as source import; no test-only registration shortcut |
| RT-24 | Real provider route configured in another agent | Mock plugin does not intercept or mutate it |

Every failure test must assert both the error and the skipped later-step list.
The session must not become permanently busy after error, rejection, or abort.

## 11. Interrupts, followup, steer, and provider routing

Use a controllable provider whose stream stays active long enough to send a
second input. Verify command routing at the turn boundary, not just with direct
parser calls.

| ID | Operation | Expected assertion |
| --- | --- | --- |
| SES-01 | Send /mock run ... as a followup while a real turn is active | Mock command is queued as the next turn; current real turn is not rewritten |
| SES-02 | Send the same command as steer while a real turn is active | Same next-turn semantics and same canonical queue result as followup |
| SES-03 | Compare followup and steer for the same mock command | Equivalent events, tool args, waits, completion, and errors |
| SES-04 | Interrupt an active mock stream | Current mock turn aborts; queued later step is not silently executed |
| SES-05 | Interrupt an explicit wait | Wait timer cancels; state returns terminal/idle according to host contract |
| SES-06 | Non-slash followup text | Routes to the configured normal/real provider; no mock parser invocation |
| SES-07 | Non-slash steer text | Routes normally; no mock queue or mock provider substitution |
| SES-08 | Normal real-provider turn followed by mock turn | Both turns coexist in one session with separate provider/stream semantics |
| SES-09 | Mock turn followed by normal real-provider turn | Mock pending state is consumed/cleared; real turn sees correct history |
| SES-10 | Malformed slash command followed by normal text | Only malformed command is diagnosed; next normal turn still routes normally |
| SES-11 | Followup/steer commands in two sessions | Next-turn queues remain isolated |
| SES-12 | Session disposal with queued followup/steer | Pending commands are cancelled and not delivered to a new session id |

A slash command is mock input by its command classification, whether it
arrives through followup or steer. A non-slash message is never reinterpreted
as mock merely because it resembles a tool expression.

## 12. Background jobs, nested agents, and child sessions

### 12.1 Background jobs

background_start is a real registered tool, so the mock plugin must not block
or special-case it. Assert:

- the parent scripted step records the normal ToolRuntime call and terminal
  result/job id;
- replay completion follows the normal parent queue contract: it occurs only
  after the final scripted step's durable result and final stop, not merely
  after emitting the call;
- a background job that continues after parent completion remains observable
  through the normal job system and is not converted into an extra scripted
  step;
- an explicit later scripted step that queries or waits for that job is
  allowed to determine its own completion;
- abort/dispose follows the normal parent/child cancellation contract and does
  not delete unrelated job records;
- job progress does not create fake wait/tool events in the canonical script.

Run parent/replay cases for immediate completion, delayed job completion,
parent abort, job failure, and replay reload.

### 12.2 Nested-agent policy

Subagent/nested-agent tools are unsupported by this replay contract. A script
that tries to invoke nested_agent must receive one deterministic documented
unsupported error (or the normal tool-policy error if the host prevents
visibility), fail according to the fail-fast policy, and skip later steps.
It must not:

- spawn a hidden child and report success;
- flatten child messages/tool events into the parent script;
- consume a child result as the parent's next scripted response;
- reuse the parent session id for child state.

If the host already creates a child session before the unsupported boundary is
reported, assert that the child remains a distinct session with its own
lifecycle and is not flattened into the parent persistence stream.

| ID | Scenario | Expected assertion |
| --- | --- | --- |
| JOB-01 | Allowed background start | Parent result durable; child job remains normal and separate |
| JOB-02 | Background job completes after parent | No duplicate replay completion or scripted step |
| JOB-03 | Explicit wait/query for background job | Parent queue waits only when the script explicitly asks it to |
| JOB-04 | Background job failure | Normal job error; parent/replay status follows documented contract |
| JOB-05 | Parent abort with child running | Parent abort is durable; child cancellation follows normal job policy |
| JOB-06 | nested_agent first step | Deterministic unsupported/policy failure; later step skipped |
| JOB-07 | nested_agent in parallel | Group policy is deterministic; no child flattening |
| JOB-08 | Child session created by host | Child id/events remain separate from parent |
| JOB-09 | Dispose with parent and child jobs | Plugin-owned state clears without deleting external job history |
| JOB-10 | Replay of a log containing child records | Converter rejects unsupported flattening or excludes child session by policy |

## 13. Session isolation, concurrency, and disposal

| ID | Scenario | Expected assertion |
| --- | --- | --- |
| SES-13 | A runs tool_a, B runs tool_b concurrently | Calls, ids, results, queues, waits, and summaries remain attached |
| SES-14 | A completes while B is waiting | A cleanup does not clear B's timer or cursor |
| SES-15 | Same tool name in A and B with different args | Args and durable events do not cross |
| SES-16 | Same adapter instance serves parallel mock sessions | No global nextCall/cursor state |
| SES-17 | Missing session id requests | Clear rejection or request-local state; never shared fallback state |
| SES-18 | Dispose with pending calls and timers | Provider unregistered; pending count/timer count zero; abort listeners removed |
| SES-19 | Dispose twice | Idempotent; no duplicate errors/events |
| SES-20 | New session after dispose | Old pending state cannot be consumed by new session |

Stress this with at least 20 interleaved sessions and randomized completion
order under a deterministic seed. Assert bounded state after every terminal
session and after context/fiber disposal.

## 14. UI states and progress semantics

The UI tests should observe accessible labels/roles and the session event/state
bridge rather than CSS implementation details. Use a fake clock or a replay
fixture so waits are deterministic.

| ID | State/scenario | Expected assertion |
| --- | --- | --- |
| UI-01 | Mock script starts | Agent is running and command is visible |
| UI-02 | Implicit 100 ms gap | Generic spinner/progress excludes the gap; no fake tool row |
| UI-03 | Explicit wait 250 | Generic tool spinner/progress excludes wait; if a dedicated wait label exists, it shows remaining/elapsed wait |
| UI-04 | Wait with long duration | Agent remains running/not idle until queue contract says terminal; UI does not imply tool execution |
| UI-05 | Parallel group | One group/progress state, no serial spinner per member caused by an artificial gap |
| UI-06 | Invalid canonical script | Immediate invalid-script error; no tool row; no stuck busy state |
| UI-07 | Invalid slash command | Command diagnostic with normal terminal state; no script progress |
| UI-08 | Unknown/invalid tool at runtime | Invalid-tool break/error at the failing step; later steps visibly skipped/not started |
| UI-09 | Tool execution error | Normal tool error presentation with preserved code/message |
| UI-10 | Approval pending | Pending/approval state, not completion or idle |
| UI-11 | Abort/interrupt during stream | Aborted state and eventual idle; no final completed badge |
| UI-12 | Abort during wait | Wait ends as aborted; no later tool appears |
| UI-13 | Queue reaches final stop | Completion is shown only after final response and durable event |
| UI-14 | Agent status transitions | running through active stream, approval, tool execution, and wait; idle only on terminal result |
| UI-15 | Reload after completed replay | Persisted canonical/session events reconstruct completion and no active spinner |
| UI-16 | Two sessions visible | Running/idle/error/progress state is scoped per session |

The generic progress aggregate must count actual active model/tool work only.
Wait duration can be exposed by a dedicated mock wait indicator, but it must
not be counted as a tool duration or cause a false tool-progress row.

## 15. Browser and profile E2E scenarios

These are browser journeys against a built external plugin and a minimal DSH
profile containing normal session, persistence, LLM, AgentLoop, ToolRuntime,
and a deterministic registered probe tool. No real provider credential is
required for mock paths.

| ID | Journey | Expected assertion |
| --- | --- | --- |
| E2E-01 | Start profile with compiled mock plugin | Profile boots; mock/mock model is discoverable; no host source change |
| E2E-02 | Enter valid single /mock run | One tool executes, result renders, session becomes idle/completed |
| E2E-03 | Enter valid parallel run | All calls/result rows appear; no artificial inter-member wait |
| E2E-04 | Enter malformed JSON and wait syntax in run | Inline diagnostic; no tool execution; composer/session remains usable |
| E2E-05 | Replay canonical JSON file | File loads, validates, executes, and persists canonical behavior |
| E2E-06 | Replay native JSONL file | Conversion groups sibling calls and sequential groups correctly |
| E2E-07 | Replay with overwrite flag | Explicit waits visibly/observably use override; implicit gaps remain 100 |
| E2E-08 | Replay invalid file | Invalid-script/file error; source remains unchanged; no partial queue |
| E2E-09 | Runtime invalid tool | Error break at failing step and later steps absent |
| E2E-10 | Interrupt or steer/followup while running | Both slash-command entry paths queue next turn identically; non-slash text routes normally |
| E2E-11 | Reload and open the completed session | Durable events/results remain; no re-execution and no spinner |
| E2E-12 | Two browser sessions concurrently | State/results do not cross; disposing one does not affect the other |

Use stable accessible locators, wait for a concrete state/event rather than a
fixed sleep, capture console errors, and assert no unhandled rejection. The
browser suite must cover Windows path quoting on the Windows runner and use
portable fixture paths elsewhere.

### 15.1 Relevant commands

Run package checks from the plugin directory:

~~~powershell
Set-Location C:\Users\yifan\code\Ephemeral-AI-Lab\dsh-plugins\mock
pnpm typecheck
pnpm build
pnpm test
~~~

For profile and browser checks, build the unchanged host checkout first, then
run the host's existing E2E/web suites with the mock profile/fixture wired by
the test harness:

~~~powershell
Set-Location C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness
pnpm build
pnpm test:e2e -- apps/web/tests/mock.e2e.ts
pnpm test:web -- apps/web/tests/mock.e2e.ts
~~~

If the host suite is filtered by Vitest configuration rather than positional
file arguments, use the repository's equivalent filter while retaining
vitest.e2e.config.ts/web configuration. The final test report must identify
which commands were run, which profile was loaded, and which E2E cases were
skipped for missing browser/runtime prerequisites. Do not run a command that
modifies the deepseek-harness worktree as part of these tests.

## 16. Static and release gates

Before declaring the suite complete:

- pnpm typecheck, pnpm build, and pnpm test pass in the plugin;
- compiled lib/index.js loads as an external package;
- provider route is exactly mock and model is mock;
- no private import from the DSH checkout exists;
- no parser/adapter eval, Function, shell execution, direct tool
  implementation call, custom policy bypass, or custom duplicate schema path
  exists;
- adapter disposal unregisters the provider and releases state;
- source and output-path safety tests pass, with destination-dependent cases
  explicitly marked BLOCKED-ON-POLICY until resolved;
- integration tests use real AgentLoop and ToolRuntime;
- malformed scripts fail before any call, runtime failures fail fast, and
  skipped later steps are observable;
- wait behavior, parallel barriers, abort behavior, and final-stop semantics
  pass under fake-clock and real-timer smoke tests;
- concurrent session and plugin disposal stress tests leave zero owned state;
- browser/profile tests pass or record a concrete prerequisite-based skip;
- no file under C:\Users\yifan\code\Ephemeral-AI-Lab\deepseek-harness was
  modified by implementation or test setup.

## 17. Exit criteria and evidence

The mock test plan is satisfied only when every matrix row has a test
name, fixture reference, level, and assertion result. The evidence bundle for
each run should include:

1. command output for typecheck/build/unit tests;
2. canonical input and normalized output for positive adapter fixtures;
3. line-numbered diagnostics for malformed JSONL and invalid scripts;
4. queue trace showing 100 ms implicit gaps, explicit waits, overwrite behavior,
   parallel barriers, and skipped steps;
5. durable event trace showing call/result correlation and final stop;
6. session-state trace for running, waiting, pending approval, error, aborted,
   completed, and idle;
7. source hash before/after replay and any output destination chosen under the
   resolved policy;
8. profile/browser result with skipped prerequisites called out;
9. cleanup report showing zero pending sessions, timers, listeners, and
   registered mock provider after disposal.

Any failure that could allow a real tool call to bypass ToolRuntime, a wait to
be treated as a tool, a malformed source to be partially replayed, a child
session to be flattened, or a second session to consume the first session's
state is release-blocking.

## 18. Historical implementation issues and regression checklist

This section records the concrete bugs found while implementing and testing the
mock/replay flow. These are historical incidents as well as regression cases;
future changes must preserve the stated behavior.

| ID | Observed symptom | Root cause | Required regression assertion |
|---|---|---|---|
| HIS-01 | The deterministic mock model appeared as an explicit model choice. | The mock provider/model route leaked into the normal model-selection surface. | `/mock` is the only mock entry point; no deterministic mock model is shown as a selectable model. |
| HIS-02 | `/mock` was absent or its browser UI was not loaded. | The patch referenced a local `file:` entry, so the web plugin scanner could not resolve package metadata or the client half. | The patch resolves the package by name; the package exports `./client`; the boot manifest contains `dsh-mock/client.js`; `/mock` is registered. |
| HIS-03 | It was unclear whether slash commands used a fake executor or the real agent. | The intended boundary was not explicit. | The slash command queues a normal user message; AgentLoop and ToolRuntime perform routing, validation, authorization, execution, and durable call/result events; the mock adapter emits only model chunks. |
| HIS-04 | A “System Prompt Updated” row appeared even though prompt mutation was not wanted. | A plugin request/header hook modified the system prompt; the host also naturally logs request/header and context-injection snapshots. | The mock plugin does not register a `request/header` mutation or update the system prompt. Host-owned context snapshots may remain ordinary logs, but no plugin-owned prompt mutation is emitted. |
| HIS-05 | Mock runs showed thinking/reasoning behavior. | The real route’s `reasoningEffort` was passed to the deterministic mock route. | The mock request omits `reasoningEffort`; no reasoning/thinking block is requested from `mock`. |
| HIS-06 | Extra context/log rows were confused with replay steps. | System-prompt, skill-catalog, session-title, and other host context events are normal session events, not scripted tool steps. | Only canonical executable steps create tool calls; the status bridge is not a conversation/tool-card definition and does not create visible transcript rows. |
| HIS-07 | Replays containing packed `tool-call-chunks` were not converted reliably. | The converter handled complete calls but not packed chunk records. | Packed chunk arrays reconstruct the same tool name, id, and JSON arguments as a complete call. |
| HIS-08 | Some JSONL files had only trailing assistant/chunk deltas and produced no call. | The converter required a complete assistant message and did not use the chunk fallback. | A valid trailing chunk sequence reconstructs one canonical tool step; incomplete deltas fail with line/record diagnostics. |
| HIS-09 | Historical tool results risked being replayed or changing the scripted arguments. | Conversion treated recorded execution output as replay work instead of input evidence. | Conversion uses historical tool calls/arguments only; it never replays historical `tool/result` events or replaces call arguments with result data. |
| HIS-10 | `--overwrite-wait-time-ms 0` was mistaken for a tool-result timeout setting. | The option controls only explicit/implicit inter-step replay gaps. | Zero removes scripted wait gaps but never causes a live tool result to be skipped or timed out. |
| HIS-11 | Every replay stopped after exactly five seconds with `missing tool result`. | `waitForReportedResults` used a fixed five-second deadline even though a real ToolRuntime call can take longer. | The adapter waits until the matching durable `tool/result` is reported; it exits only on result, cancellation, or disposal. There is no fixed five-second protocol timeout. |
| HIS-12 | After removing the timeout, the replay could remain blocked even after the tool finished. | Auxiliary `session-title`/compaction LLM calls entered the same mock plan and competed for its pending result/cursor. | Auxiliary calls bypass the mock plan and use the real provider when available; only the actual AgentLoop request consumes replay steps. |
| HIS-13 | Replay progress existed on the host but no progress bar appeared in the browser. | There was no client bundle, projection registration, or `conversation.input.dock` slot contribution. | A session-scoped status row above the composer shows mode and `current/total`; the progress element has an accessible `progressbar` role. |
| HIS-14 | An existing browser tab showed stale UI or `web-runtime connection lost`, while a new session worked. | The tab held an old client/runtime connection and did not have the new projection state. | Refresh/reconnect and new-session smoke tests load the mock client bundle and receive live status frames; an active replay reaches the browser UI. |
| HIS-15 | A previous failed/waiting row remained visible after rebuilding or restarting. | The terminal/stuck status was persisted from the old run, while the in-memory adapter plan no longer existed. | Completed/cancelled runs do not show an active row after reload; stale persisted waiting state must be identified and handled rather than presented as a live run. |
| HIS-16 | Local package-name resolution failed during profile testing. | The test profile did not have an installed `dsh-mock` package, so package-name loading needed a local profile junction. | The test profile setup documents package resolution; normal installation resolves the package without modifying the host source checkout. |
| HIS-17 | A replay could appear to be waiting while a tool row already showed execution time. | Tool completion and the next AgentLoop request are separate event boundaries; the UI did not distinguish host execution from adapter handoff. | Status remains `waiting` only until the result reaches the mock adapter, then advances to the next step or terminal completion; tool duration alone is not treated as adapter completion. |
| HIS-18 | Mock routing could leak into the next ordinary user turn. | The temporary mock provider route was persisted or not restored after the mock turn. | After mock completion/failure/abort, the next normal turn uses the configured real provider/model; no mock model/header mutation remains. |

### 18.1 Reproduction fixtures and evidence

The primary external fixture was:

~~~text
C:\Users\yifan\Downloads\dsh-session-session-bada1bd3-0a37-417b-bbdf-2c9b5844967f.zip
~~~

Its extracted JSONL converted to 13 canonical records and 7 executable replay
steps. The same fixture was replayed through the browser after the auxiliary
call fix: it advanced through `4/7`, then `7/7`, and completed with
`Mock replay completed (7 executable steps)` after the live tool results
arrived.

The current package evidence is:

- `pnpm typecheck` passes;
- `pnpm build` passes;
- `pnpm test` passes with 35 tests;
- the adapter regression test covers auxiliary calls while a mock tool result
  is pending;
- the host checkout remains unmodified by the plugin implementation.
