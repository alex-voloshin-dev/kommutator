# Independent QA

QA inspected integrated source after the hello-close attribution fix and added two
behavior tests in commit `b03aeb8`:

- A real loopback WebSocket rejects synchronization twice, then recovers. Connection
  spacing respects increasing backoff; a later mutation with a lost response is not
  replayed by HubLink after reconnect, and subsequent status works.
- A compiled Codex hook receives registration rejection from a real IPC server. It exits
  zero with empty stdout/stderr and records only bounded registration/hello evidence.

The ordered build, typecheck and full workspace suite passed on the first attempt:
protocol 41, hub 209, agentd 263, CLI 336 — **849 tests**. Both new tests also passed
focused execution before the full gate. The compiled hook measured 123.654 ms, below
the 200 ms target and temporary strict 300 ms limit. No above-target sample was printed
in this run. No existing tests or deadlines were weakened.

Logs: `/tmp/kom-reliability-nov25-qa-{build,typecheck,ws,hook,test}.log`.
QA edited only its two test files and released dist ownership before parent packaging.
No runtime services or production database were modified. Release packaging remains a
separate gate. These controls do not establish historical #9/#19/#22/#25 causes.

## Parent packaging gate — failed

The subsequent complete `pnpm release:check` passed install/audit/catalog checks,
build/typecheck, protocol41, hub209 and agentd263. CLI finished333 passed/3 failed:
rejected-hook fixture deadline, cold SessionStart setup IPC timeout, and an output-written
hook retaining only an attempted observation. Script tests and exported E2E were not reached.
The gate log is `/tmp/kom-v0170-release-check.log`. At03:03:03UTC a separate snapshot showed
IO-full avg10=15.99% and memory-full=1.09%; production hub/daemon were sleeping in epoll.
This snapshot does not establish the failures' cause. No deadlines were changed. A bounded
focused diagnostic is separate from qualification; the first green workspace run remains
valid but does not explain this failed packaging run.
