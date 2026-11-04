# Topic delivery during session absence

## Scope and assumptions

The user requested a fix for topic messages silently omitted while a subscribed session
is gone. Absence does not cancel membership. Capture recipients when sending, rather
than reconstructing historical membership on recovery. Direct, role and all addressing
retain their live-only behavior. No automatic pre-fix historical backfill is authorized
by current membership alone.

## Implementation

The hub commits deliveries and transaction-scoped sequences for every current topic
member, including gone/ended sessions, without pushing to those absent recipients.
The daemon resyncs after successful reincarnation and after queued session policy updates
have drained. Recovery does not mark messages read. Existing DND, kind-based wake rules,
idempotency and ownership checks remain in force. No schema or wire changes are required.

DESIGN section 19 records the recovery contract; PROTOCOL and MVP criteria are aligned.
Long-ended members can accumulate unread rows; pruning remains deferred.

## Verification

Independent implementation, correctness/integration review, security review and QA ran in
an isolated worktree. External review found a resync ordering defect: the hub's old DND
state could be cached as a permanent false wake decision. Resync was moved after queued
updates, with on/off regressions. QA added a SQLite snapshot/reopen test covering unread
persistence, no topic-kind wake, replay and denial of history to later subscribers.

The initial full run had three CLI process timing failures; all five tests in those two
files passed in isolation, then the full ordered build/typecheck/test run passed. This is
synthetic evidence, not a live vendor resume observation. Release/deployment evidence and
final counts are recorded separately. Existing day-long, reboot and subnet gates remain.
