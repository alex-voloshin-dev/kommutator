# ADR 002: Owner-scoped, bounded observation lookup

## Context

Shared daemons serve multiple Codex roots and Claude owners. Local keys, handles and hub
incarnations alone do not establish current authority. Diagnostic retention must not become
an unbounded replay database, and a local query must work during hub outages.

## Decision

Require ordinary binding plus an immutable connection owner snapshot captured during
original hello admission/binding before its flush wait. Existing `currentOwner` only
pins Claude process ownership; Codex's local key alone is insufficient when another shim
replaces the same root's owner. Require successful completed hello with matching PID,
process birth, generation, lifecycle epoch, root/conversation identity and local key;
never capture authority lazily on a later query or re-pin a replaced peer. Check this
snapshot at tracked admission, after asynchronous waits and at lookup, then compare
the operation's admitted owner snapshot and logical session UUID. Keep legacy methods
unchanged. Failed/incomplete hello cannot use tracked operations. Preserve
normal same-owner daemon restart recovery, but reject retired/replaced owners and distinct
logical sessions. Skip only Claude's remote preflight for this local query; preserve local
generation checks and prohibit registration recovery in the query path.

Cap the journal at 4,096 rows; retain confirmed observations for 24 hours and at most 256
per owner, evicting only terminal diagnostic records. Never evict observations linked to
unresolved outbox rows. Reject new tracked admission when unresolved observations fill the
cap. Expired/missing/foreign lookups are unknown and authorize no replay. IDs are generated
fresh by the shim and cannot be supplied or reused through the MCP mutation input.

## Alternatives considered

- **Match hub incarnation exactly:** easy isolation, but normal daemon restart reincarnates
  a still-live owner and makes the durable result inaccessible. Reject in favor of exact
  owner/lifecycle facts plus logical session UUID.
- **Local key or session UUID alone:** allows historical observations to cross process or
  conversation revival. Rejected; current binding and an admitted owner snapshot are needed.
- **Capture the peer owner at its first tracked call:** a successor may already have
  replaced the record, granting the old connection successor authority. Rejected; pin at
  original hello admission/binding before asynchronous flush and never re-pin that peer.
- **Unbound management lookup:** avoids remote preflight but lets callers choose a different
  owner and bypasses normal root/generation authority. Rejected.
- **Unlimited journal:** simplifies querying old results but creates unbounded new storage.
  Rejected; diagnostic results are not permanent replay keys.
- **Evict unresolved observations or prune outbox:** would lose promised active-operation
  evidence or risk replay/data loss. Reject in favor of bounded admission backpressure.
- **Caller-reusable idempotency IDs:** would require persistent tombstones or a formally
  expiring token scheme before eviction was safe. Unnecessary because phase one never
  resubmits mutations and uses fresh internal correlations.

## Consequences

After retention, process replacement or loss of the correlation itself, outcome can remain
unknown. A prolonged outage can fill tracked-operation capacity; this must fail before
admission rather than silently erase work. No current hub/session replay retention changes.
