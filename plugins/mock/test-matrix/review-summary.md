# Test-matrix audit summary

The bounded review verdict is **AMBER**: the baseline is justified and broad,
but it should not yet be treated as a clean release gate. The main issue is
not missing happy paths; it is duplicated assertions, underspecified source
policies, and race conditions around cancellation, late results, approval, and
turn restoration.

## Keep, merge, and add

Keep the core parser, canonical schema, converter, timing, adapter, and real
runtime cases. Merge or parameterize these overlaps:

- parser-versus-validator JSON argument preservation;
- adapter direct-execution proof and the real-loop ToolRuntime sentinel;
- provider metadata/model-page non-mutation;
- missing-session-id checks;
- runtime error variants;
- twenty-session stress as nightly rather than every commit.

Add these high-value cases before calling the backend matrix complete:

| Priority | IDs | Edge case |
| --- | --- | --- |
| High | `SCH-21`, `SCH-22` | Duplicate JSON keys and explicit size/depth/resource-limit policy. |
| High | `C-17..C-20` | Complete-vs-delta fallback, grouping boundaries, timestamp ambiguity, and exact call-identity mismatch. |
| High | `Q-19..Q-22` | Multiple default gaps, generic fail-fast variants, fail-closed queue compilation, and wrong pending result IDs. |
| Critical | `ASTR-15..16` | Abort before the first chunk and repeated/re-entered stream requests without duplicate calls. |
| Critical | `RTI-16..18` | Parallel sibling failure, abort during real tool execution, and late approval after cancellation. |
| Critical | `RTE-15..17` | Result/interrupt race, disposal of queued followup/steer, and real-provider restoration after failure/cancel. |
| High | `JOB-16..18` | Generated job-id data flow, unavailable nested-agent metadata, and stale results from an earlier turn in the same session. |
| Medium | `EVT-01` | Serializable mock lifecycle events and the documented fallback when no public extension point exists. |

The cases should compare stable DSH error codes, flags, event kinds, and
ordering rather than brittle full prose or private call-stack details.

## Test levels

- **Unit/release gate:** parser, validator, converter, fake-clock queue, and
  adapter stream behavior.
- **Integration/release gate:** compact parameterized real
  AgentLoop/ToolRuntime, policy, cancellation, routing, jobs, isolation, and
  disposal cases.
- **Smoke/nightly:** compiled external loading, child-session host behavior,
  OS background-job history, twenty-session stress, and source/hash checks.

## Time estimate

These are planning estimates from the review, not measured test results:

| Work | Estimate |
| --- | ---: |
| Resolve normative policies (duplicate keys, empty scripts, timestamps, path/limits) | 0.5–1 day |
| Add parser/converter/timing edge cases | 1–2 days |
| Add runtime race/integration cases | 2–4 days |
| Materialize and wire fast replay fixtures | 0.25–0.5 day |
| **Likely total with parameterization** | **3–6 working days** |

The runtime estimate assumes the needed public DSH APIs are available. Private
observability requirements or unavailable child-session/job APIs should be
demoted to smoke tests or replaced with public event assertions.

## Fast replay plan

The custom scripts in `replay-fixtures/` use 100 ms implicit gaps and explicit
waits from 100–250 ms. They avoid real LLM inference latency and long-running
shell/background commands. The complete already-booted backend smoke budget is
approximately 3 seconds; unit timing tests should use a fake clock and run in
well under one second.
