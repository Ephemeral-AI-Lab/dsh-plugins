Start with a clean disposable session at fake time 0. Create /loop 1
HARD_RACE_TARGET. Block the runtime's pre-fold persistence flush. At the due
boundary, concurrently request the runtime drive and execute /loop delete
<target-id> through the real CommandRuntime. Release the queue and let all
pending work settle.

Assert that the final durable state has no active target loop, no heartbeat was
sent for a deleted loop, and no later timer can resurrect it. Then create
/loop 1 HARD_RACE_CONTROL and prove a normal loop still delivers once.
