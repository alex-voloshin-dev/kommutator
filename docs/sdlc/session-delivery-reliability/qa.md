---
type: qa
feature: session-delivery-reliability
status: passed
date: 2026-11-04
---

# QA: session delivery reliability

## Scope and changes

Reviewed the approved research brief, QA role, engineering standards, TypeScript testing conventions, implementation and existing tests. Strengthened tests only; no production code changes or live service mutations were made by QA.

Added seven cases:

- `packages/agentd/test/daemon-core.test.ts`: missing and throwing process-birth probes preserve an ended Codex registration without hub mutation; a subsequent verified birth restores the same session. Revoked topic membership is rejected when a DND-paused watch becomes active; the paused poll performs no hub request and keeps its cursor.
- `packages/cli/test/watch.test.ts`: a malformed page terminates without output, retry or cursor consumption.
- `packages/cli/test/process-reliability.test.ts`: the built hook exits successfully within 200ms with no stdout when IPC stalls; a displayed header followed by acknowledgement failure retains output and records `output-written-ack-unverified`, without exposing synthetic transport details. The built watch emits no stdout and creates no daemon/runtime files when its daemon is absent, then exits cleanly on SIGTERM.

The final run also includes the implementation's hub coverage for gone-session pauses, hop 3 versus hop 4, direct-message exclusion, topic authorization, read-delivery observation and receipt preservation.

## Executed checks

Used Node v24.22.1 and pnpm 10.18.0 from the feature worktree. Executed in the required order:

| Command | Outcome | Local evidence |
| --- | --- | --- |
| `pnpm -r build` | Passed, exit 0 | `/tmp/kom-qa-build.log` |
| `pnpm -r typecheck` | Passed, exit 0 | `/tmp/kom-qa-types.log` |
| `pnpm -r test` | Passed, exit 0 | `/tmp/kom-qa-tests.log` |

The suite passed **487 tests**: protocol 34, hub 174, agentd 99, CLI 180. The logs are local execution evidence, not published artifacts. Production entrypoint checks used the rebuilt `dist/` in temporary homes with isolated IPC fixtures.

No implementation defect was surfaced by the added cases. No existing test was removed, skipped or weakened. QA did not run packaging checks; those belong to the release gate.

## Remaining gates and limitations

- A real vendor Monitor invocation and idle event delivery are not established by subprocess tests. No claim of universal native idle wake or indefinite monitoring follows from these results.
- Preserve the existing day-long, Windows reboot and physical-subnet acceptance gates.
- Watch cursors are process-local: manual restart with `--since-seq` may repeat observed events. Stdout observation does not acknowledge delivery or prove that a model acted on a message.
- The historical Codex retirement remains unexplained. The independently reproduced missing-birth defect and its regression tests do not prove that incident's cause.
- Hook observation slots are bounded best-effort diagnostics; interrupted executions and collisions can leave unknown or missing evidence. No observation is not proof that a hook succeeded.

## Release qualification follow-up

The first 0.10.0 release qualification run passed 486 of 487 workspace tests; the cold
SessionStart lifecycle test failed with an IPC timeout. Archive packaging was concurrent,
but this does not establish causation. Its complete three-test file then passed in
isolation, without source/test changes or increased timeouts. Full release qualification
was restarted without concurrent packaging; its final result is recorded in deployment.

The first GitHub push run for 633e85b failed the existing Claude B→A→B resume process
case: final `whoami` returned A's ID. The independent pull-request run of the same change
passed. Publication was held; this intermittent identity result was investigated instead
of treating a passing rerun as sufficient. Follow-up diagnostics and regression evidence
are recorded below after the investigation.

## Round 3: diagnostic I/O and conversation authority

Independent inspection found two awaited diagnostic writes before Claude SessionStart
published its generation. A controlled built-process probe stalled only diagnostic-directory
creation, leaving identity storage operational. The control published one generation;
the stalled run exited successfully within 200ms but published none. This establishes a
critical-path defect, without proving the precise latency experienced in GitHub CI.

Added a permanent process regression in `packages/cli/test/claude-resume-process.test.ts`.
A child-only preload makes `mkdir` for `hook-observations` never resolve. Before the fix,
the new test failed with expected `resumed-b`, received `launch-a`, despite passing the
unchanged 200ms assertion (`/tmp/kom-qa-stall-before.log`). The implementation now queues
observation writes in order without awaiting them before identity or delivery work, and
flushes best-effort evidence afterward under the existing entrypoint deadline.

After rebuilding, all three resume-process tests passed, including resumed authority and
SessionEnd invalidation while diagnostic storage remained stalled
(`/tmp/kom-qa-stall-after.log`). The fixture also records sanitized synthetic generation
and observation evidence for future failures. No timeout was increased or assertion weakened.

Final ordered round-3 checks all exited 0:

| Command | Local evidence |
| --- | --- |
| `pnpm -r build` | `/tmp/kom-qa-round3-build.log` |
| `pnpm -r typecheck` | `/tmp/kom-qa-round3-types.log` |
| `pnpm -r test` | `/tmp/kom-qa-round3-tests.log` |

The final suite passed **488 tests**: protocol 34, hub 174, agentd 99, CLI 181.
QA made no production edits and did not rerun remote CI or change user runtime state.
Release packaging and remote CI remain the maintainer's next gates; the live-acceptance
limitations above remain open.
