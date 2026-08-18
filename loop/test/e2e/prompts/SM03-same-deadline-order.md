Clean the disposable session first. Create /loop 1 LOOP_E2E_FIRST and then
/loop 1 LOOP_E2E_SECOND. At the first due boundary, inspect the inbox and
confirm both heartbeats arrive exactly once and in creation/event-fold order.
Delete both loops and confirm the next interval produces no additional
messages.
