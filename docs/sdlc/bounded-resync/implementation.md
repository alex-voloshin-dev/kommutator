---
type: implementation
feature: bounded-resync
status: ready-for-review
---

# Bounded resync implementation

Implementation follows the approved three-round design and ADRs. The isolated branch
merged origin/main at 704f66e before source edits, retaining the 0.15.2 diagnostics patch.
DESIGN §19 was updated before executable behavior. No deployment, production database,
MCP configuration or release version has been changed by this implementation task.

## Changes

- Add negotiated hub-only `deliveries.resync.page`, fixed highwaters, count/encoded byte
  bounds and read-only transaction selection. Legacy RPC behavior remains available.
- Add schema 8 transactional migrations from 5/6/7 and fresh-schema indexes for unread
  sequence selection and message-target lookup. Bound target reconstruction to 21 rows.
- Add a serialized daemon coordinator shared by reconnect and post-reincarnation paths,
  with round-robin pages, immutable owner snapshots and connection-epoch fences.
- Commit local page deduplication before wake scheduling; keep acted marks independent.
  Replace completion-time body materialization with a pending-wake existence query.
- Validate negotiated capabilities and clear them on disconnect; no advertised-error
  fallback. Legacy capability absence emits one diagnostic per connection epoch.
- Extend schema-aware cleanup guards without executing cleanup. The release updater has
  no hub schema allowlist: its `schema: 1` is the independent checkpoint format.

## Validation observed

- Isolated frozen-lockfile installation passed with the repository-pinned toolchain.
- Final ordered recursive build, typecheck and tests passed: 767 workspace tests
  (41 protocol, 207 hub, 226 agentd, 293 CLI). Modified cleanup script tests: 14 passed.
- First ordered test run failed one new hub fixture: its replay key `later` was below
  the existing minimum. Corrected to `later-message`, without relaxing validation.
- Second ordered run passed hub tests but caught a real integration regression in an
  existing daemon lifecycle test: synchronization returned successfully after flush
  disconnected. Restored OfflineError for disconnected/changed-epoch post-flush state.
  Third ordered run passed. Logs: /tmp/kom-bounded-{build,types,tests}3.log;
  earlier failed test logs: /tmp/kom-bounded-tests.log and tests2.log.
- Actual schema-7 built hub reader rejected a new schema-8 temporary database.
- release:check and independent review/QA remain pending; this is an implementation
  handoff, not release qualification.
- Tests added for bounded encoded/control/Unicode payloads, count and empty pages,
  highwater stability, authorization, DND/read gaps, replay and target reconstruction;
  query plans include sparse unread and unrelated target history.
- Added migration rollback tests for failure at the second index and updated historical
  schema fixtures to actually remove the new indexes before testing upgrade.
- Added daemon lifecycle/epoch/disconnect/shutdown fences, malformed pages, overlap and
  fair ordering tests, plus real-socket 200 × 60,000-character recovery.

Baseline evidence is retained in reproduction.json and issue #31. The original
/tmp/kom-transport-repro.mjs uses the legacy RPC: it must remain a failing large-backlog
control, including against a new hub when driven by an old client. Candidate acceptance
uses the negotiated daemon coordinator, not a rewritten legacy control. Successful
controlled recovery does not establish the cause of historical issue #22 outages.

## Limits

No receipt inference, unknown-operation resend, timeout increase or queue deletion is
introduced. Old daemons and hubs retain the legacy burst limitation. Live push floods
can still exceed transport backpressure. Index-build startup cost is separate from
bounded page work. Local wake existence queries bound materialized results, not rows
examined. Day-long, physical subnet, unattended reboot and native Work gates stay open.

## Real-socket observations

Versioned evidence: [implementation observations](../../../spikes/evidence/2026-11-14-bounded-resync-implementation.json).
The unchanged baseline 0.15.1 control retains 12 connections/zero completed syncs for
200 large messages; five-message control completes on one connection. Candidate hub
with an explicitly legacy client still reproduces 12 connections, zero syncs and 516
notifications in 1.8 seconds. This compatibility limitation is intentional and visible.

An initial 1.8-second candidate observation retained 112/200 deliveries with one stable
connection and no errors; it was not completion. A bounded completion observation then
finished at 3628 ms, one connection, all 200 retained, zero errors, hub unread 200 and
local acked 0. The real-socket automated test also covers post-reincarnation recovery.
A new daemon against the old built hub recovered the small five-message control using
legacy fallback. The reproducible isolated probe is `spikes/bounded-resync-probe.mjs`;
it never uses configured service endpoints or persistent runtime databases.

Remaining qualification includes representative migration duration/disk-size evidence,
independent review/QA, final packaging, and public release/rollout if approved by gates.

## Review round 1 revisions

Independent review found two real recovery gaps. Both were reproduced with tests
before changing their implementation:

1. An empty run followed immediately by an owner enqueue, and an enqueue between a
   terminal response and cleanup, could return success without making the queued request.
   Both tests failed against the first implementation. The pump now rechecks pending
   work after drain completion and clears its running state in that same continuation.
2. An actual Claude hook registration refresh from generation 1 to 2 invalidated a held
   page but did not request a new page. The core-level regression returned `finished`
   instead of entering a fresh request. Verified registration now retains an exact
   refreshed-owner snapshot and queues a fresh pass after policy writes settle. It
   does not wait behind the old response to acknowledge registration. The test holds
   both responses: the old response leaves storage empty; only the fresh generation's
   response creates the delivery, with local acked=0 and hub unread unchanged.

Red logs: `/tmp/kom-bounded-round1-race-red.log` and
`/tmp/kom-bounded-round1-refresh-red.log`. An intermediate pump draft added an unnecessary
initial microtask yield, breaking six existing fixture assumptions about an already
started request; the extra yield was removed and the original tests were retained.
Targeted green logs: `/tmp/kom-bounded-round1-race-green2.log` and
`/tmp/kom-bounded-round1-refresh-green.log`. Ordered final validation is recorded below.

## Synthetic migration qualification

[Migration evidence](../../../spikes/evidence/2026-11-14-bounded-resync-migration.json)
records a disposable schema-7 fixture with 100,000 messages, targets and deliveries,
99,900 read and 100 unread. Candidate migration took 72.828 ms; checkpointed file size
changed from 54,665,216 to 57,647,104 bytes. All eleven table hashes/counts and receipts
were unchanged; quick_check, foreign keys and schema-8 reopen passed. All four query
chains use the expected indexes without table scans or temporary sorting.

This was one serial nice=10 run on six logical CPUs / about 8.2 GB WSL memory, with
SQLite cache 4 MiB, bounded seeding batches and memory guards. The 100,000-row fixture
was removed. This small-body synthetic measurement does not guarantee production
migration duration, full capacity, physical subnet or day-long behavior. No live
service/database or deployment configuration was changed.

Round-1 revision validation: recursive build, typecheck and all 770 workspace tests
passed in the required order (41 protocol, 207 hub, 229 agentd, 293 CLI). Logs:
`/tmp/kom-bounded-round1-build.log`, `types.log` and `tests.log` with the same prefix.
The previously passed 14 cleanup tests were not repeated: their code was unchanged.
Independent round-2 review, QA and packaging remain pending.

## Review round 2 revisions

Two further integration gaps were reproduced before their fixes:

- Duplicate-only refresh recovery retained unread local work but never rearmed the
  native wake cancelled by the registration refresh. A core ManualClock test now
  retains a waking delivery, holds the old resync response, refreshes the actual
  Claude registration, and holds/releases the fresh duplicate-only response. The
  active owner makes exactly one native attempt, while ended, replaced-conversation
  and DND controls make none. No receipt.mark is sent; hub unread state is preserved.
  Existing native-attempt local ledger semantics are unchanged.
- Startup reincarnation submitted one owner at a time and drained its entire backlog.
  A persisted two-owner daemon restart now verifies first-page order large-owner,
  small-owner before the large owner's second page. Post-policy-flush eligible owners
  are collected once and submitted together, preserving registration-pending gates.

Successful recovery completion now shares the pending-wake existence check across
callers, revalidating the captured connection epoch, open/connected state, exact owner
and current DND policy before scheduling. Duplicate ingestion itself still does not
schedule a fresh wake. The scheduler retains one timer per owner.

Both substantive regressions failed in `/tmp/kom-bounded-round2-red2.log`; all five
new cases passed in `/tmp/kom-bounded-round2-green.log`. An earlier test draft omitted
`op: update` from its DND command and correctly received lifecycle rejection; only
that fixture was corrected before the product fix. Its log is retained as
`/tmp/kom-bounded-round2-red.log`. Ordered validation is recorded below.

The first round-2 full gate passed build/typecheck and 41 protocol + 207 hub + 234
agentd tests, then passed 292/293 CLI tests. The failing existing process test was
`publishes resumed authority and ends it even when diagnostic storage never completes`:
its first whoami after initial `launch-a` hook returned `Shared daemon unavailable`
at line 297, before the diagnostic-stall preload or resumed generation was exercised.
The cause is not established or equated with historical issues #19/#22/#25. Log:
`/tmp/kom-bounded-round2-tests.log`. Cleanup already removed this run's fixture home;
remaining similarly named homes were historical Nov 11/12 fixtures and were not read.
The fixture drains child stderr, and its optional hook evidence was not enabled for
the failing run, so the missing startup/probe phases cannot be reconstructed.

An unchanged targeted rerun passed (one selected test); this does not explain the
failure. Log: `/tmp/kom-bounded-round2-lifecycle-targeted.log`. An earlier mistyped
package filter matched no projects and is invalid evidence, not a test pass.
No timeout or assertion was relaxed. Final ordered repeat is recorded below.

Final round-2 ordered repeat passed recursive build, typecheck and all 775 workspace
tests (41 protocol, 207 hub, 234 agentd, 293 CLI). Logs:
`/tmp/kom-bounded-round2-build-final.log`, `types-final.log` and `tests-final.log`
with the same prefix. Source remained unchanged between the failed full run,
targeted rerun and successful full repeat. The initial availability failure remains
unexplained. Source is frozen for independent QA and final review.
