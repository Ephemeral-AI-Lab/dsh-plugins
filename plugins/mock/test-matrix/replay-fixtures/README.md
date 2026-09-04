# Fast replay fixtures

These canonical scripts are deterministic test inputs for backend replay
tests. They use the matrix fixtures (`probe_tool`, `ordered_tool`,
`throws_tool`, and `needs_value`) and intentionally avoid real LLM inference,
network calls, shell loops, filesystem mutation, and browser state.

The explicit waits are deliberately short. The replay policy still applies:
omitted edges use 100 ms, explicit waits use their stated value, and
`--overwrite-wait-time-ms` replaces explicit waits only in memory.

| Fixture | Coverage | Logical wait budget | Expected quick duration |
| --- | --- | ---: | ---: |
| `rf-01-single.json` | Single successful tool | 0 ms | 20–100 ms |
| `rf-02-parallel-wait.json` | Parallel barrier and explicit wait | 200 ms | 220–350 ms |
| `rf-03-timing.json` | Explicit 150 ms plus implicit 100 ms | 250 ms | 270–380 ms |
| `rf-04-execution-error.json` | Runtime execution failure and fail-fast | 100 ms | 20–220 ms |
| `rf-04-unknown-tool.json` | Real `UNKNOWN_TOOL` and fail-fast | 0 ms | 20–100 ms |
| `rf-04-invalid-args.json` | Real `INVALID_ARGS` and fail-fast | 0 ms | 20–100 ms |
| `rf-05-cancel-wait.json` | Cancellation during explicit wait | 0–100 ms | 100–180 ms |
| `rf-06-reload.json` | Durable reload without re-execution | 100 ms | 130–260 ms |

The complete quick-smoke target is approximately 3 seconds in one already
booted backend process. Unit tests should use a recording/fake clock rather
than sleeping.
