Clean the disposable session first. Run /loop list and delete every existing
loop. Create /loop 1 LOOP_E2E_IDLE. Wait for exactly one heartbeat. Inspect
the session inbox and confirm the message contains LOOP_E2E_IDLE, uses the loop
plugin source, targets the idle-agent next-turn path, and has wakeup=true.
Delete the loop, advance one more interval, and confirm no further heartbeat
arrives.
