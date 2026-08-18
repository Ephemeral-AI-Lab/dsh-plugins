# Backend test matrix index

This directory expands areas 1–8 of `test.md` into executable backend test
cases. The browser/UI cases remain in `test.md` and `ui/ui-ux.md` because they
require the real DSH web client.

The audit and recommended additions are summarized in
[review-summary.md](review-summary.md), with detailed area reviews in
[review-01-04.md](review-01-04.md) and [review-05-08.md](review-05-08.md).
Fast canonical replay inputs are in
[replay-fixtures/](replay-fixtures/README.md).

## Coverage map

| Area | Focus | Case IDs | Cases | Draft |
| --- | --- | --- | ---: | --- |
| 1 | Slash-command parser | `CMD-01..18` | 18 | [01-02-parser-schema.md](01-02-parser-schema.md) |
| 2 | Canonical schema/validator | `SCH-01..20` | 20 | [01-02-parser-schema.md](01-02-parser-schema.md) |
| 3 | DSH JSONL and format conversion | `C-01..16` | 16 | [03-04-conversion-timing.md](03-04-conversion-timing.md) |
| 4 | Timing and replay queue | `Q-01..18` | 18 | [03-04-conversion-timing.md](03-04-conversion-timing.md) |
| 5 | Adapter stream contract | `ASTR-01..14` | 14 | [05-08-runtime.md](05-08-runtime.md) |
| 6 | Real AgentLoop/ToolRuntime | `RTI-01..15` | 15 | [05-08-runtime.md](05-08-runtime.md) |
| 7 | Cancellation, follow-up, steer, routing | `RTE-01..14` | 14 | [05-08-runtime.md](05-08-runtime.md) |
| 8 | Jobs, subagents, isolation, disposal | `JOB-01..15` | 15 | [05-08-runtime.md](05-08-runtime.md) |
| **Total** |  |  | **130** |  |

## Difficulty policy

Areas 1 and 2 are simple backend clusters and each exceeds the ten-case
minimum. Areas 3–8 are workflow/runtime clusters and contain 92 classified
cases:

| Difficulty | Cases |
| --- | ---: |
| Easy | 24 |
| Medium | 31 |
| Hard | 37 |

This exceeds the required minimum of 10 easy, 10 medium, and 10 hard cases
for the complex cluster.

Difficulty is interpreted as:

- **Easy:** one pure input, one state transition, or one direct contract.
- **Medium:** multiple records/steps, a real runtime boundary, or a timing/
  error interaction.
- **Hard:** cross-session concurrency, cancellation races, approval or policy,
  durable-event/reload behavior, background jobs, disposal, or a multi-step
  workflow with fail-fast behavior.

## Required case fields

Every row identifies:

- stable test ID;
- difficulty and test level;
- fixture/setup and exact input;
- expected observable result;
- invariant or forbidden shortcut being protected.

Negative cases must also prove that no unauthorized tool execution, queue
advance, durable event, source-file mutation, or stuck running state occurs.

## Execution order

Run the suites in dependency order:

1. Areas 1–2: parser and canonical validator.
2. Areas 3–4: conversion, timing, and queue compilation using fake clocks.
3. Area 5: adapter stream contract without a tool registry.
4. Areas 6–8: real DSH AgentLoop/ToolRuntime, lifecycle, jobs, concurrency,
   and disposal.
5. UI and browser smoke cases from `test.md` after backend behavior passes.

The backend suites should be the main regression gate. Browser tests should
focus on actual web placement, composer submission, normal DSH cards, and a
small set of end-to-end journeys rather than duplicating every backend row.
