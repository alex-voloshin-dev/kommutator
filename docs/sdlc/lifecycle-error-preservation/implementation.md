# Lifecycle primary-error preservation

## Scope and assumptions

The direct maintainer request is the plan: repair confirmed loss of diagnostic evidence
while investigating unresolved hook/registration/availability failures. This is fixture-only;
no runtime, wire schema, identity, delivery, replay, receipt or deadline behavior changes.
The authoritative gate is the repository Node26.13.0/pnpm12.18.0 build → typecheck → test.
Stack detection reports the root JavaScript manifest; the changed tests use the existing
strict TypeScript conventions. Independent review/QA and full qualification remain pending.

Prior evidence: `docs/sdlc/reliability-nov25/qa.md` retains the three failed CLI packaging
cases. A cold SessionStart assertion/operation could be replaced by cleanup IPC failure;
this does not establish the historical triggering failure. `operability-evidence.md` and
`autonomous-kommutator-maintenance.md` require observed evidence and preserve unknowns.

## Implementation

`process-lifecycle.test.ts` now runs lifecycle bodies through the existing `withCleanup`
helper, retaining the original body error first and cleanup errors separately. The same
rule covers constructor failure and nested rejected-listener cleanup. Shutdown phase
context is added only after the existing ENOENT/ECONNREFUSED classification, preserving
benign absent-daemon cleanup. Parent-owned, fixed-label phase observations are bounded to
32 entries, with elapsed time, hub-listening and numeric resource counts. Failure snapshots
are emitted before cleanup or killing a timed-out hook; no message, token, endpoint or
arbitrary remote error is copied into these snapshots. The existing 3s fixture guard,
500ms management timeout, 300ms process assertion and 140/90ms runtime deadlines are unchanged.

## Controlled reproduction

The new regression uses the actual fixture and a private Unix management server that
accepts but never answers hello. A body error plus the existing shutdown deadline must
retain both errors and report the pre-cleanup state; the temporary fixture directory must
still be removed. Replacing only its new run wrapper with the historical try/finally
control makes the test fail: the observed first error is cleanup, not the body error.
The candidate was restored byte-identically and the same regression passed. This is a
controlled reproduction of masking, not a reproduction of the historical registration outage.

## Checks actually run

- Frozen install, ordered workspace build and typecheck passed.
- An initial package filter matched no projects: no tests executed, not a passing gate.
- First real focused run:7 passed/2 failed. Candidate-only mistakes: wrapping shutdown
  before classifying ENOENT hid the benign code; the new assertion expected nonexistent
  timeout wording. Both corrected using the observed error structure, without weakening
  prior assertions or deadlines. Log `/tmp/kom-lifecycle-focused-real.log` retained.
- Repeated ordered build/typecheck passed; focused fixture/lifecycle suite:9/9 passed
  (`/tmp/kom-lifecycle-{build2,types2,focused2}.log`).
- Controlled historical wrapper:1 failed/4 unselected, as expected
  (`/tmp/kom-lifecycle-baseline-fixture.log`).
- Restored candidate regression:1 passed/4 unselected
  (`/tmp/kom-lifecycle-candidate-fixture.log`).

No production service, database, kernel setting or queue was changed. Full workspace and
release qualification are not claimed here. Historical issues9/19/22/25 remain open.

## Review hardening

The reviewer identified two diagnostic-path weaknesses: a throwing output sink could mask
an original failure or prevent timeout termination, and the new regression's listener startup
did not handle its error event. Reporting is now explicitly best-effort. The same real
body-plus-shutdown regression runs with both a normal and throwing diagnostic sink; both
must preserve the original failure and complete cleanup. Listener startup uses error-aware
listen inside the fixture's cleanup wrapper, so startup rejection also closes the fixture.
Ordered build/typecheck and the expanded focused suite are recorded below after execution.

Review-hardening validation passed: ordered workspace build/typecheck, then focused10/10.
Logs: `/tmp/kom-lifecycle-review-{build,types,focused}.log`. No new failed attempts.
