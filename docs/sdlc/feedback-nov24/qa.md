# Independent QA — feedback follow-up

## Scope

Executed against the integrated candidate in `kommutator-feedback-nov24`, using Node
26.13.0 and pnpm 12.18.0 with independent workspace dependencies. Round 1 included
`c77f09f` plus the QA tests committed as `75d2641`; round 2 included the fixture repair
`20cc918f8a770a7a5b56fbdaeefbed23614ac411`. No production services, credentials, permissions,
queues or databases were changed. Build and typecheck preceded the workspace test runs.

## Tests added

- Concurrent project lookups share one rejected promise, both callers observe the failure,
  and later callers discover and retain the recovered remote instead of a poisoned cache.
- A watch error whose code contains an allowlisted prefix followed by injected private text
  receives only the generic fixed diagnostic, without output, retries or reflected text.

Existing implementation tests cover fresh Git initialization and a new Claude owner,
rejection of changed project context for an existing owner, preserved original identity and
membership, in-flight negative discovery, positive caching, warm launcher write avoidance,
hostile cache paths and allowlisted IPC permission guidance.

## Round 1

- `pnpm -r build`: passed.
- `pnpm -r typecheck`: passed.
- Focused project/core selection: 8 passed, 123 unrelated tests filtered.
- Focused watch: 6 passed.
- Hosted launcher script tests: 19 passed, no skips.
- `pnpm -r test`: **failed**. Protocol 41 passed; hub 209 passed; agentd 250 passed,
  5 failed and 7 unhandled errors. CLI was not reached.

All five failed tests were in `operations.test.ts`: two Codex replacement assertions saw
PID 123 instead of 456; two Claude refresh assertions saw generation 1 instead of 2;
the delayed-registration switch-back case resolved its middle hello instead of rejecting.
Four failed cases then hit the existing 10-second teardown hook timeout. Unfinished
assertion promises and daemon-stopping errors were reported separately.

The readiness loops awaited only 100 `Promise.resolve()` microtasks. Negative-cache
eviction now causes another real Git subprocess before registration, which those loops
cannot wait for. The engineer's controlled A/B retained the same test file: candidate
project lookup produced 5 failures/42 passes/7 errors; original cached lookup produced
47 passes. Those A/B runs were inspected from their saved logs, not repeated by QA.

The fixture repair observes the exact successful `registry.save` for the requested owner
PID/generation and drains deferred work before cleanup. It invokes the real save and keeps
all original fencing and settlement assertions. No production timeout or authority rule
was relaxed. QA inspected this synchronization change independently.

## Round 2

- `pnpm -r build`: passed.
- `pnpm -r typecheck`: passed.
- `pnpm -r test`: **failed**. Protocol 41 passed; hub 205 passed and 4 failed;
  agentd and CLI were not reached.
- The four unchanged hub cases exceeded the existing 5-second test budget: schema 5-to-8
  history preservation, absent-subscriber mail across reopen, schema-6 index migration
  rollback, and `VACUUM INTO` backup of an open WAL database. Reported case durations were
  approximately 6.4–7.3 seconds. No instrumentation in this run establishes their cause.
- Host IO-full avg10 was about 3.2% before the run and 9.95% at the post-failure sample.
  These observations alone do not attribute the timeouts to storage or concurrent load.
- Authorized targeted verification after the failure: **54 agentd tests passed**
  (47 operation tests and 7 project tests), and **6 watch tests passed**.
  This confirms the repaired operation fixture under the focused run; it does not erase
  either failed full gate or establish that the entire candidate is qualified.

## Evidence and remaining gates

Local logs:

- `/tmp/kom-nov24-qa-build.log`, `/tmp/kom-nov24-qa-typecheck.log`
- `/tmp/kom-nov24-qa-focused-agentd.log`, `/tmp/kom-nov24-qa-focused-cli.log`
- `/tmp/kom-nov24-qa-hosted.log`, `/tmp/kom-nov24-qa-workspace.log`
- `/tmp/kom-nov24-qa-round2-build.log`, `/tmp/kom-nov24-qa-round2-typecheck.log`
- `/tmp/kom-nov24-qa-round2-workspace.log`
- `/tmp/kom-nov24-qa-round2-focused-agentd.log`, `/tmp/kom-nov24-qa-round2-focused-cli.log`

QA also inspected the engineer's saved exported-bundle read-only probe: the baseline failed
at chmod with EROFS, the candidate's `watch --help` exited successfully, and a private
permission-denied socket produced fixed EACCES guidance with empty stdout. These were
engineer-run observations, not independent QA reruns. They do not establish actual Codex
workspace-write socket access or native wake.

No third full local retry was made. Complete exact-head hosted qualification, regenerated
matching release artifacts, packaging, public installation and any deployment remain the
maintainer's gates. This report does **not** declare the full local suite green.
