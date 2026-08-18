Start with a clean disposable session at fake time 0. Create /loop 1
HARD_RECOVERY. At the due boundary, allow Agent.send() to succeed, append the
dispatch event, and make only the post-dispatch session flush fail. Assert the
failure is observable and no successful durable completion is reported.

Recover persistence and request another drive. Assert the same due occurrence
is not sent a second time. Advance to the next occurrence and assert exactly
one new heartbeat with a strictly greater next_at. Dispose and resume the same
session once more to prove the recovered durable state reconstructs correctly.
