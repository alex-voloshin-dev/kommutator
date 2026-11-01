# Feedback maintainer QA

Observed on 2026-11-01 in the isolated implementation worktree, Linux/WSL, Node 24.
This QA used temporary databases, synthetic message bodies and child processes. It did not
start the production maintainer, send live hub messages, or publish a release.

## Added coverage

Five behavior tests in `scripts/feedback-maintainer.test.mjs` cover:

- Historic inclusion imports only sanitized fields and cannot admit synthetic or
  acknowledgement traffic.
- Reopening the queue fences an interrupted attempt once, retains its attempt count, and
  preserves report identities across repeated recovery and import.
- Aborting a worker terminates its process-group descendant, including a descendant with
  no inherited output pipes.
- Output overflow rejects execution and leaves a bounded, private log.
- Supervisor hub/GitHub/provider secrets are omitted from the worker environment.

Existing tests additionally cover exact-scope private opt-in policy, queue deduplication,
serialization, empty-queue behavior, explicit reconciliation, result validation, release
verification failures, observer exact-key backfill, stable replay after lost acknowledgements,
and report failures isolated from inbox capture.

## Executed checks

- `node --check scripts/feedback-maintainer.test.mjs`: passed before focused execution.
- `pnpm test:feedback-maintainer`: 13 passed, 0 failed.
- `pnpm test:feedback-observer`: 18 passed, 0 failed, including actual observer subprocess,
  TCP/WebSocket hub, mailbox recovery, kernel lock and shutdown tests.
- `git diff --check`: passed.

The implementation engineer separately reported completed workspace build, typecheck,
386 workspace tests, release checks, exported-plugin verification and bundle smoke/E2E.
Those are not represented here as independently rerun QA checks. No implementation defect
was exposed by the added tests; no implementation source was edited by QA.

## Gate and limits

QA gate: **pass for the candidate's tested queue, observer and process behavior**.
Real systemd sandbox execution, credentials/network, a live engineering job and a verified
public release remain operational acceptance owned by the coordinating maintainer. The
supervisor's release check is not proof that a model executed every required engineering
workflow gate. Reboot, day-long use and physical-subnet acceptance remain open.
