# QA: canonical feedback topic migration

## Scope and evidence

Independent QA ran on the migration worktree rebased onto `d12064f` (v0.6.0), using Node 24.22.1. The implementation engineer owns the ordered workspace build, typecheck, test and packaging gates; those results are not claimed here.

Command: `node --test scripts/feedback-topic-migration.test.mjs`

Result: **11 passed, 0 failed**. No production services, private journals, hub configuration or releases were changed by QA.

## Added and strengthened coverage

- Crash recovery now includes all six injected phases, including readiness before final marker completion. Normal observer and maintainer constructors refuse partially migrated state; rerunning retains report IDs and avoids repeated capture.
- Failed capture preserves old identity while fencing normal runtime startup. Retry completes migration.
- Wrong host configuration and public configuration permissions fail before capture or creation of a recovery marker.
- A socket-free integration test uses the production hub JSON dispatcher and SQLite handlers. It commits a legacy-topic triage reply, loses its acknowledgement, migrates, then verifies the exact original request replays successfully with its session, parent, body, topic and key unchanged. Only one committed reply exists. Subsequent canonical-topic feedback receives its own reply and key; a new archive-topic post is ignored.
- CLI subprocess tests acquire each actual kernel service lock in turn. The operator command exits 75 without creating a marker or changing the stored session.

Existing migration fixtures also verify retained host/session/cursor, private backup modes, report routing, pending historical imports limited to the captured ID whitelist, restoration of previously ignored canonical-topic arrivals, active-job refusal and idempotent completion.

## Standalone observer follow-up

External review identified that the original joint migration required a maintainer installation even for observer-only deployments. After the implementation added explicit observer-only mode, independent coverage verified:

- Migration succeeds with no maintainer state directory, policy or skill installation and creates none of them.
- Observer host/session, cursor, job sequence and replay keys survive; the private SQLite backup retains the original identity and cursor.
- Interruptions at prepared, captured, observer and ready phases recover idempotently; partial states fence normal observer startup.
- Existing maintainer state, policy or historical publication metadata prevents standalone mode from silently omitting the maintainer.
- An interrupted joint migration cannot be converted into standalone mode by removing its maintainer recovery files.
- The standalone CLI obeys the existing observer kernel lock without creating a maintainer directory.

The final focused run passed all 11 tests, including the original joint migration and production-dispatcher replay checks.

## Findings and limits

No additional implementation defect surfaced in these checks; the standalone installation gap was identified by external review and covered in the follow-up above. The initial capture-failure test expected startup to remain possible; it was updated to assert the newly required fail-closed runtime fence, while independently checking that the old identity remains stored.

The production-hub test deliberately replaces the migration transport boundary with the same dispatcher used by the hub; it does not qualify the WebSocket cutover transport, its 100-page mailbox bound, or real machine restart behavior. The parent operator must observe actual cutover and service health. Physical subnet, reboot/logon and day-long operation gates remain open.
