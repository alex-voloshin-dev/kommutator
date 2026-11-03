# Dashboard usability QA

## Cleanup checks

Independent QA ran `node --test scripts/test-data-cleanup.test.mjs` on the integrated
feature worktree with Node 24.22.1: **12 passed, 0 failed**. No live services or production
data were modified. `git diff --check` also passed.

Four cases were added to the engineer's eight tests:

- The actual CLI defaults to dry-run, requires the explicit stopped-hub acknowledgement
  for apply, and completes/idempotently replays the reviewed cleanup.
- Malformed JSON, broadly readable manifests and manifest symlinks are rejected. A
  synthetic private marker inside invalid JSON does not appear in CLI output.
- An injected SQLite deletion failure after earlier message/delivery deletes proves
  transaction rollback restores payload rows and retired-operation keys. The private
  pre-cleanup backup remains readable and contains the original data.
- Unrelated real messages, recipient receipts, protected board/current-history records,
  session counters and registration snapshots survive unchanged.

Existing coverage was retained: actual WebSocket lost-acknowledgement retries for all three
retired key types; additive/idempotent schema 5-to-6 upgrade; unsupported-schema refusal;
nonmutating dry-run; stale fingerprint, active-session, incomplete closure and protected
board refusal; isolated test host/topic closure; recreated-primary-record refusal; and no
backup overwrite. The isolated-closure test's SQLite null-prototype rows were compared by
selected scalar fields instead of against plain-object prototypes; its behavioral assertions
were preserved.

No implementation defect surfaced in these checks. The stopped-hub flag is an operator
acknowledgement, not process detection. A concurrent-write race during the backup itself was
not independently injected; the implementation's locked revalidation remains covered by
review, while the tests exercise stale plans and atomic rollback separately.

## Dashboard recovery and filtering checks

After implementation review, independent QA ran
`pnpm --filter @kommutator/hub exec vitest run test/dashboard.test.ts test/transport.test.ts`:
**32 passed, 0 failed** across the two files. Four UI behavior cases were added:

- A failed one-shot Refresh while paused retains the last snapshot and timestamp, exposes
  an actionable error, and never retries automatically, including after SSE reconnect.
  An explicit retry succeeds without resuming automatic updates.
- Pause followed by Resume during an older pending request discards that request's failure
  and performs a fresh fetch without exposing an obsolete error or dropping retained data.
- Pausing before the initial fetch prevents automatic work and never presents unloaded
  metrics as zero. A one-shot refresh works while updates remain paused.
- Delivery search and receipt filters combine, preserve selection across a receipt update,
  and clear locally without issuing message reads or additional snapshot requests.

The engineer's original cases remain intact, including topic membership/history counts,
malformed snapshot retention, periodic refresh, pause/resume, focus/disclosure continuity,
ended-session filtering, bounded activity and authentication/transport behavior. No product
code was changed and no additional defect surfaced. The test harness models DOM behavior;
it is not a substitute for Chromium keyboard, layout or assistive-technology acceptance.

## Remaining evidence

Dashboard browser/keyboard/reflow checks, final workspace build/typecheck/test, release
qualification and actual cleanup/deployment are owned by the coordinating agent. These
cleanup tests do not establish those outcomes, physical subnet isolation, reboot/logon,
native vendor wake or day-long operation.
