# Review: backend test matrix areas 1-4

Scope: `SPEC.md`, `test.md`, `test-matrix/README.md`,
`test-matrix/01-02-parser-schema.md`, and
`test-matrix/03-04-conversion-timing.md`. This is a bounded review only; no
tests, builds, or servers were run.

## Overall verdict

Keep the matrix as the baseline. It covers the main happy paths and most of
the required security and queue invariants, but it is not yet a clean,
executable gate. The highest-risk gaps are duplicate-key policy, timestamp
provenance/ambiguity, JSONL representation fallback, exact mismatch identity,
and fail-closed queue compilation.

## Verdict by area

| Area | Verdict | Justified coverage | Redundant, misplaced, or underspecified |
| --- | --- | --- | --- |
| 1. Slash parser | **Mostly justified; tighten boundaries** | `CMD-01..04`, `CMD-06..13`, and the option/path cases in `CMD-17..18` directly exercise the grammar, JSON-only parsing, parser security, and no-wait rule. | `CMD-05` duplicates the runtime-boundary intent of `SCH-20` and later runtime cases. `CMD-09` overlaps `SCH-10`; retain both only if one is explicitly parser-level and the other validator-level. `CMD-14..16` are routing/isolation follow-up cases, better owned by areas 7-8. `CMD-17` assumes an "approved reader" while path resolution policy is still open in `SPEC.md`. `CMD-18` combines acceptance and rejection fixtures without separately asserting option order and duplicate-option behavior. |
| 2. Canonical schema | **Strong core; policy decisions needed** | `SCH-01..04`, `SCH-06..14`, `SCH-16`, and `SCH-18..20` cover canonical shape, strict fields, inert JSON data, wait placement, parallel grouping, cloning, shared validation, and delegation to ToolRuntime. | `SCH-02` repeats `CMD-02` data-preservation coverage; `SCH-05` and `SCH-09` both cover tool-name boundaries. `SCH-07` rejects an empty script although the canonical grammar in `SPEC.md` does not explicitly say `steps` is nonempty; this needs a single documented decision. `SCH-15` requires duplicate-key rejection but no duplicate-key policy or duplicate-aware JSON parser is specified. `SCH-17` refers to configured depth/size limits that are not defined. |
| 3. JSONL conversion | **Good grouping/result baseline; incomplete source-model coverage** | `C-01..07`, `C-09..11`, `C-13`, and `C-15..16` cover sibling grouping, sequential ordering, omission of historical results, timing derivation, precedence, mismatch reporting, fresh call IDs, and source safety. | `C-04`, `C-12`, and `C-16` substantially repeat historical-result suppression at increasing levels; keep one unit and one integration assertion. `C-14` overlaps `SCH-19`. `C-03` and `C-15` use shorthand such as `message(1,2)` and "documented durable ordering" without defining whether grouping is by message, turn/step, sequence, or stream reconstruction. `C-08` does not define the required result for conflicting boundaries, missing units, or mixed timestamp units. `C-09` covers name/args mismatch but not call-identity mismatch. `C-10` says "conversion/invalid-script" instead of asserting the required error class per input. |
| 4. Timing and replay queue | **Strong scheduling core; fail-fast policy needs expansion** | `Q-01..09`, `Q-12..14`, `Q-17`, and `Q-18` cover default versus explicit waits, overwrite semantics, parallel barriers, out-of-order results, cancellation, stale results, and a useful end-to-end success smoke. | `Q-10` and `Q-11` are valuable but only cover unknown/invalid args and one thrown sibling; policy denial, invalid output, and generic `isError` fail-fast are absent here. `Q-14`/`Q-15` are two layers of the same cancellation contract and should share a fixture. `Q-16` is primarily area-8 session isolation. `Q-18` should be counted as a smoke test, not as additional unique coverage. There is no explicit compiler fail-closed case when validation or overwrite-option validation is bypassed. |

## Missing or high-value additions

Estimates are per case/family and assume existing fixtures, a fake clock, and
the recording observers described by the matrix.

| Proposed ID | Missing edge case / expected assertion | Severity | Level | Rough implementation / runtime |
| --- | --- | --- | --- | --- |
| CMD-19 | Replay format detection: canonical JSON, DSH JSONL, misleading extension, and unsupported content select the documented adapter or fail before queue creation. | Medium | U | 1-2 h / <1 s |
| CMD-20 | Path-policy boundary after the policy is chosen: relative/absolute roots, traversal, symlink escape, quoted separators, and unreadable source. No source read/write occurs on rejection. | High | E | 2-4 h / 1-5 s; blocked until path policy is documented |
| SCH-21 | Parse raw JSON with duplicate root/step keys under one explicit policy (prefer reject); distinguish this from an already-parsed last-key-wins object. | High | U | 1-2 h / <1 s |
| SCH-22 | Enforce declared size/depth limits with deterministic diagnostics, no stack overflow/hang, and no queue entry. Remove "configured" wording until limits are specified. | High | U | 1-3 h / <2 s |
| C-17 | Positive fallback coverage for complete assistant chunks, durable `tool/call` only, packed fragments only, and delta fragments only, including multiple IDs and ordering. | High | U | 2-4 h / <2 s |
| C-18 | Grouping boundaries with text between sibling blocks, multiple chunks for one assistant step, repeated call records, and same turn/step versus distinct step values. | High | U | 1-2 h / <1 s |
| C-19 | Timestamp ambiguity matrix: absent unit, mismatched units, start-vs-end ambiguity, conflicting candidate boundaries, equal timestamps, and nonmonotonic values. Assert either explicit wait, default gap, or conversion error exactly as policy requires. | High | U | 2-3 h / <2 s |
| C-20 | Same claimed call identity with different name, args, or ID; exact duplicate call records; and same name/args with distinct IDs. Assert `CONVERSION_MISMATCH` versus one deduplicated call. | High | U | 1-2 h / <1 s |
| C-21 | Source-byte snapshot after malformed input, canonical-validation failure, and plugin disposal, in addition to the existing success/runtime-failure/cancellation checks in `C-13`. | Medium | E | 1-2 h / 2-5 s |
| Q-19 | Three sequential tools must produce exactly two 100 ms gaps; add an explicit wait after a parallel group and verify it starts only after the group barrier. | Medium | U | 1-2 h / <1 s |
| Q-20 | Generic fail-fast family: policy denial, execution failure, invalid output, and other `isError` results stop later top-level steps while already-emitted siblings settle normally. | High | I | 2-4 h / 3-8 s |
| Q-21 | Compiler fails closed for invalid/unsafe wait values or an invalid overwrite value when called with a mocked-validator bypass; no timer is scheduled. | High | U | 1-2 h / <1 s |
| Q-22 | Unknown or wrong result ID while a step is still pending, not only a duplicate after advancement; it must not consume another pending call or advance the cursor. | High | U | 1-2 h / <1 s |

## Recommended matrix cleanup

1. Keep the unit cases, but label `CMD-05`, `CMD-14..16`, and `Q-16` as
   cross-area handoff tests so they are not counted as parser/queue coverage.
2. Make the parser-versus-validator distinction explicit for the overlapping
   object-argument and JSON-data cases; otherwise collapse the duplicate rows.
3. Resolve three normative policies before implementation: empty-script
   acceptance, duplicate JSON keys, and nonmonotonic/conflicting timestamps.
4. Keep `Q-18` as the single full-replay smoke test after the focused unit and
   integration cases pass.
