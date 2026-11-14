# Bounded resync — independent QA

Target implementation: 40cd921, after the two implementation review revisions.
QA changed test files only; no product code, service, configuration or runtime database
was changed. Existing tests and identity/receipt/deadline assertions were preserved.

## Tests added

- Actual DaemonCore page-ingestion fault: a SQLite trigger aborts the second insert.
  The first insert rolls back, no native wake or receipt is produced, and a later
  successful recovery retains both rows and makes one coalesced native attempt.
  The fixture adapter returns written, so both hub deliveries remain unread.
- Coordinator rejects 33-item and oversized encoded-byte pages before any ingestion
  or wake, preserving the durable acted cursor.
- A changed highwater on the second page rejects that entire continuation while
  preserving the earlier valid page and its unchanged acted state.
- Hub continuation honors reads and DND changes between pages while retaining the
  original highwater, skipping read rows and emitting no new receipts/events.
- Process-fixture failure evidence is captured before cleanup without registering
  the failed Claude identity or retrying its call. The evidence excludes fixture
  paths, credentials, environment and conversation IDs; it includes bounded phase
  timings, hook exits, process/socket/metadata booleans and a pure daemon.runtime
  probe. Normal successful assertions retain the original deadlines.

The failure capture supports future investigation of the observed initial-whoami
Shared daemon unavailable failure. It does not explain that historical failure or
establish that it shares the causes of issues #19, #22 or #25.

## Executed checks

- Targeted agentd resync/core: 143 tests passed.
- Targeted hub pages: 8 tests passed.
- Targeted Claude resume process fixture: 7 tests passed.
- Ordered recursive build, typecheck and workspace test suite passed on the initial
  QA draft: 781 tests (41 protocol, 208 hub, 238 agentd, 294 CLI).
- Root review noticed the first diagnostic draft used daemon.status, which can
  asynchronously reconcile/flush. The probe was corrected to pure daemon.runtime
  before final qualification; no production endpoint was used.
- Final ordered gate: see /tmp/kom-bounded-qa-final-build.log,
  /tmp/kom-bounded-qa-final-typecheck.log and /tmp/kom-bounded-qa-final-tests.log.
  All three commands exited zero; all 781 workspace tests passed (41 protocol,
  208 hub, 238 agentd, 294 CLI).

An initial targeted CLI invocation used a nonexistent package filter and ran no
tests. It is not qualification evidence; the corrected packages/cli invocation
produced the seven-test result above. Logs are retained under /tmp/kom-bounded-qa-*.
No failed behavior assertion was weakened or retried into a claimed explanation.

## Remaining gates and limits

No new confirmed product defect was surfaced by the added QA cases. Existing
controlled red/green regressions and migration tests were included in the full suite.
The representative 100,000-row migration measurement is the engineer's separate
recorded experiment, not an independent QA rerun. Release packaging, CI, public
installation and actual rollout remain maintainer gates. Synthetic fixtures do not
establish real native Work/idle wake, physical subnet, reboot or day-long acceptance.
Historical availability and hook-latency failures remain unexplained by green tests.
