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
