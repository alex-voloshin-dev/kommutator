---
type: tech-design
feature: bounded-resync
status: proposed
review_decision: proceed
decisions:
  - "Add a bounded pull RPC for resynchronization; keep receipts separate from scan progress."
  - "Use a fixed per-session highwater and sequential pages with bounded encoded size."
  - "Add unread sequence and message-target lookup indexes through one atomic hub schema 8 migration."
  - "Negotiate additive support; preserve legacy semantics without claiming legacy repair."
components:
  - "Protocol method/result schemas and hello capability advertisement"
  - "Hub read-only page selection and byte accounting"
  - "Hub schema 8 migration and indexed page/body reconstruction queries"
  - "Daemon resynchronization coordinator and durable delivery ingestion"
  - "Controlled reconnect and mixed-version regression tests"
risks:
  - "Legacy daemons retain the old burst behavior until upgraded."
  - "Real-time push traffic can independently cause socket backpressure."
  - "Lifecycle changes during an awaited page require exact local ownership revalidation."
  - "A valid page is not a receipt; accidental cursor reuse could lose unread delivery."
  - "Building the two indexes can extend the maintenance window on a large database."
---

# Bounded delivery resynchronization

## Inputs, evidence and scope

No PRD exists for this maintenance fix. The maintainer's request to repair confirmed
reliability defects is the input. Assumed goals are eventual recovery of a finite
retained backlog, bounded work per RPC, unchanged unread/read semantics and explicit
mixed-version limits. This design passed independent and external review in round 3.

The investigation reports an isolated 0.15.1 reproduction with 200 unread messages
whose bodies contain 60,000 characters. The current hub collects and synchronously
emits all resync notifications. `server.ts` terminates a socket after its buffered
amount exceeds 1 MiB. Reconnect repeats the same unread backlog. The reported run
made 12 connections and completed zero resyncs in 1.8 seconds, retaining all 200
unread rows. The retained second large-backlog run records 516 delivery notifications
and 216 server errors; the earlier exploratory run reported 473 notifications and
must not be conflated with that retained run. The five-message control records one
connection, one completed resync, five notifications, zero server errors and five
unread rows. Source artifacts are `/tmp/kom-transport-repro.mjs`,
`/tmp/kom-transport-backlog200.json`, `/tmp/kom-transport-backlog5.json` and
`/tmp/kom-transport-investigation.md`; the orchestrator must preserve these outside
temporary storage as versioned evidence before implementation qualification.
The confirmed controlled defect is tracked separately as issue #31.

This mechanism is a confirmed controlled defect, not an established cause of all
historical issue #22 outages. This design does not change timeouts, kernel settings,
read receipts, mutation reconciliation, queue disposal or native wake policy.

Relevant prior decisions: [[../../knowledge/protocol-and-boundaries]] keeps host and
session authority at the hub and read receipts distinct from socket delivery;
[[../../knowledge/codex-root-identity]] forbids inferred identity;
[[../../knowledge/operability-evidence]] separates controlled and field acceptance.

## Current behavior

`Methods["deliveries.resync"]` accepts a map of session IDs to acted cursors. The hub
authorizes the entire map first, selects every unread row above each cursor, loads
every body, then emits `deliver` notifications synchronously. Agentd calls it during
connection synchronization and after settled reincarnation operations. Receipt
cursors remain conservative and may stay below gaps; local `(session_id, seq)`
deduplication makes re-emitting retained unread messages safe but expensive.

The WebSocket output limit is a protective bound, not the bug to remove. Making it
unbounded would exchange disconnections for uncontrolled memory growth. Merely
limiting the old resync query would silently strand older clients' remaining rows.

## Wire contract

Add the new hub-only RPC `deliveries.resync.page`. It is not exposed as a model tool
and is never forwarded as an arbitrary shim method. Leave `deliveries.resync`
unchanged, including authorization of its complete supplied map before emission.

Request:

```text
{ session_id: SessionId, after: safe nonnegative integer,
  through?: safe nonnegative integer }
```

Response:

```text
{ session_id: SessionId, through: safe nonnegative integer,
  cursor: safe nonnegative integer, more: boolean,
  deliveries: DeliverNotification[] }
```

One session per request makes the authorization unit unambiguous: authorize that
session against the authenticated host before selecting any row or body. This does
not relax the old multi-session method's all-before-emission check. No caller-supplied
host is accepted. Use the existing `requireSession` state policy; do not add access
to historical or other-host sessions.

On the first page, omit `through`; the hub reads the current maximum sequence for
the authorized session in the same synchronous transaction as page selection and
sets `through = max(after, current maximum)`. Later requests repeat that exact
`through`. Require `after <= through` when it is supplied. A supplied highwater is
a scan bound, not an authorization credential; the hub reauthorizes every request.

Select rows satisfying `state = unread AND after < seq AND seq <= through`, ordered
by sequence. Return at most 32 deliveries and at most **512 KiB of UTF-8 encoded
result JSON**, including the result envelope fields. The outer JSON-RPC reply has
an independently bounded ID (already at most 128 characters), leaving ample room
below the existing 1 MiB frame maximum. Keep the final dispatcher frame-size check.
The implementation must test escaped control characters and multi-byte text; JS
string length is not encoded size.

Use a SQL `LIMIT 33` metadata query, load bodies one at a time, and stop before
adding a delivery that would exceed the count or encoded-byte bound. At most the
selected page plus one candidate body is resident for page construction; never
construct the whole backlog or use an unbounded `.all()` query. The current message
limits admit a singleton within 512 KiB, but enforce this rather than assuming it:
if the first candidate cannot fit, return a fixed size error and no progress;
never skip or truncate a body. No page emits `deliver` events as a side effect.

`LIMIT 33` alone bounds returned metadata, not examined database rows. The current
`packages/hub/schema.sql` has the `(session_id, seq)` uniqueness index but no unread
range index, so long read-history gaps can cause an arbitrarily large synchronous
scan. Add the partial index:

```sql
CREATE INDEX deliveries_unread_session_seq
ON deliveries(session_id, seq) WHERE state = 'unread';
```

The page query must use the literal `state = 'unread'` predicate and the indexed
session/sequence range. Verify with `EXPLAIN QUERY PLAN` that this index supplies
the range in sequence order without a table scan or temporary sort, including a
fixture with a long read-history gap and sparse unread rows. Metadata examination
then scales with an index seek plus at most 33 matching entries, not the length
of read history. Bodies remain loaded only for bounded candidates. The first-page
highwater query uses the existing `(session_id, seq)` index for a maximum sequence;
verify that plan as well. This is a work bound, not an absolute latency guarantee
under filesystem stalls or host CPU starvation.

Bounded delivery selection is insufficient unless body reconstruction is indexed
too. `getStoredMessage()` calls `targetsFor()`, whose current query has no index
on `message_targets.message_id`. Add a second index in the same schema-8 migration:

```sql
CREATE INDEX message_targets_message_id ON message_targets(message_id);
```

The complete page query chain must be qualified, not only its first SELECT:

| Query | Indexed access and bound |
| --- | --- |
| `requireSession` | `sessions(id)` primary-key lookup before any data selection |
| Initial maximum sequence | Existing unique `(session_id, seq)` index supplies the session's highwater |
| Unread metadata | Partial unread `(session_id, seq)` index supplies the ordered range with `LIMIT 33` |
| Message and immutable author reconstruction | `messages(id)` and joined `sessions(id)` primary-key lookups |
| Original address list | New `message_targets(message_id)` index, at most `LIMITS.recipients + 1` rows |

Normal `message.send` validates at most 20 target strings and canonicalizes/deduplicates
before storing targets; these are original addresses, not the expanded delivery
audience. The SQL table itself has no per-message cardinality constraint. Bound
`targetsFor` to 21 rows and reject malformed stored data with more than 20 targets
using a fixed internal-data error; never truncate addresses into an apparently valid
message. Retain sorting/formatting of the valid target set, including `@project`.
This preserves the existing fact that a stored message exceeding the target schema
cannot be returned successfully, while bounding its pre-validation materialization.

Use a fixture with large unrelated target history to verify `targetsFor` uses
`message_targets_message_id` rather than `SCAN message_targets`; assert the entire
reconstruction path returns unchanged valid messages. The bound is indexed seeks
plus the bounded page and bounded targets per candidate, conventionally
`O(log N + page_size * log N + page_payload)` for these fixed-count lookups, not
constant I/O or a guaranteed duration. No page handler invokes recipient expansion
or `deliveryStates`, whose fanout belongs to other RPCs.

If candidates remain within the highwater, return `more=true` and `cursor` equal
to the last included sequence. Otherwise return `more=false` and `cursor=through`.
A nonterminal page must contain at least one delivery and advance `cursor`.
Read rows and deleted/absent gaps need no delivery; advancing a scan past them
does not change receipts. Empty terminal pages are valid. Each returned wake flag
is recomputed exactly as legacy resync: stored delivery wake AND current session
`wake == on`. Preserve FYI, hop and force-wake routing decisions already stored.

## Daemon coordinator

Replace both new-capability resync call sites with one shared helper. A connection
synchronization captures a finite list of live local owners after the required
outbox/lifecycle flush. For each owner, start from its durable acted cursor and
request pages sequentially. Capture each session's highwater when its first page
begins; do not refresh it while paging that session. Arrivals above the bound use
normal live push and are revisited on a later reconnect if that push is lost.

Keep at most one resync page RPC in flight per daemon. Serialize/coalesce overlapping
connection and reincarnation requests, with a pending-owner set bounded by the
registry. A request raised during a pass receives a later pass, not an unbounded
recursive call. The helper itself must not call `flush()`; the connection and
post-flush callers retain their existing flush ordering. This avoids awaiting the
same in-progress flush from inside its own post-flush resync work.
In particular, `synchronize()` must await `flush()` before acquiring the resync
coordinator. A post-flush reincarnation resync may complete while that outer flush
is still active, but cannot call or await `flush()` itself. If an owner is queued
while a pass is active, the coordinator records pending work rather than recursively
awaiting its own pass promise. Existing readiness semantics need not be redesigned
to implement this ordering; readiness improvements are separate work.

Before each request and after each await, verify the coordinator/connection epoch
is still current and the daemon is open. Re-read the local record and require the
captured key, hub session ID and lifecycle/owner facts to match and remain live.
On replacement, ending or an unverified owner, abandon that owner's old pass;
schedule a fresh pass only for a separately verified current owner. Do not inject
stale results into a replacement merely because its hub ID happens to match.

Validate each result before ingestion: requested session ID, unchanged highwater
after the first response, monotonic cursor within the bound, strictly increasing
delivery sequences in `(after, cursor]`, matching delivery session IDs, at most 32
items, encoded-size bound, and nonempty progress when `more=true`. Require
`cursor` to equal the last included sequence for `more=true`, and `cursor == through`
for `more=false`; test malformed terminal cursors explicitly. Reject a malformed
page without changing any receipt or scan cursor. Keep error text fixed and safe.

Commit the valid page to local storage via the existing durable `registry.receive`
dedupe, preferably in one local transaction. Only after that commit advance the
in-memory page cursor. A process crash between commit and cursor advance replays
the page safely. Do not persist this cursor into `record.acked`, mark deliveries
acted, call `receipt.mark`, or infer delivery from a socket callback.

Use a shared ingestion routine for page results and live `deliver` notifications:
fresh inserts alone schedule wake, current local owner policy is rechecked, and
existing cooldown/DND/native gates remain authoritative. Live notifications may
arrive between pages or before an older page result; `(session_id, seq)` dedupe
handles this without treating a high received sequence as proof of lower receipt.
If a message was read remotely after page selection, this has the same conservative
duplicate-delivery possibility as existing push; it must not manufacture a new read
receipt or bypass owner/policy checks.
Collect fresh inserts during the transaction and schedule their wake effects only
after commit succeeds. A rolled-back page must not launch a vendor delivery task.

On a lost response or disconnect, stop that pass. A fresh connection starts from
durable acted state, not a remembered page cursor: repeated notifications remain
safe and unread rows cannot be skipped because an earlier response was lost.
On shutdown cancel/suppress queued resync passes and reject late continuation work.
Use a transport generation token or equivalent explicit coordinator cancellation
so an old connection's async completion cannot resume against a newer connection.

Avoid materializing the current resync completion path's entire
`pending(...).some(...)` body array: use an existence query for pending wake work
where needed. This bounds the returned/materialized result, not necessarily the
number of local rows examined: daemon schema 5 has no pending-wake index. The
indexed per-RPC work claim above applies to the hub page handler; this change does
not promise constant-time local wake discovery, all vendor adapter processing or
an overall process memory cap. Do not introduce a daemon schema migration solely
by calling an unindexed existence query scan-bounded.

Finite captured owner lists and fixed per-session highwaters ensure one pass can
finish despite continuing new arrivals. Each RPC yields to the event loop; no
single response holds the entire backlog. Round-robin one page per captured owner
while retaining one in-flight page and each owner's fixed highwater, so a large
backlog does not monopolize all recovery work before a small sibling's first page.
Retain only cursor/highwater/owner metadata between pages, not previous page arrays.
Progress must not depend on receipt ACKs.
The finite owner metadata snapshot is proportional to registered live owners;
this design bounds per-page body memory, not total registry metadata size.

## Compatibility and deployment

Add an optional finite capability advertisement to the hub `hello` result, for
example `capabilities: ["resync-page-v1"]`. Older clients ignore the additional
result field. New HubLink retains the validated capability for the current
connection only and clears it on disconnect. New agentd selects the new method
only when explicitly advertised; absence uses the existing legacy resync path and
records a bounded diagnostic that bounded resync is unavailable. Do not infer
support from a version string or retry an unknown method forever. If the hub
advertises support but returns method-not-found or a malformed result, fail that
pass with a fixed diagnostic; do not silently fall back to the legacy path and
claim the bounded guarantee. A missing capability and a broken advertised capability
are distinct states.

This is additive to the hub protocol and does not change MCP/IPC ownership or the
local runtime contract. Keep runtime contract 4 and daemon schema 5. The two required
indexes change the SQL layout, so **hub schema becomes 8**; do not add them under
schema 7 despite unchanged row fields. See the migration contract below.
The new method must not be passed as extra parameters to old resync: old object
parsers could strip them and silently perform an unbounded replay.

Deployment order is hub first, then each host's daemon. New hub + old daemon keeps
legacy behavior and therefore **does not fix the large-backlog loop on that host**.
New daemon + old hub preserves legacy compatibility but is not qualified for the
large-backlog fix. New hub + new daemon is the fixed combination. Local rollout does
not upgrade a remote fleet; report versions per host. No blanket client shutdown,
queue clearing, timeout increase or database downgrade is part of this migration.

### Hub schema 8 migration and rollout

Update `packages/hub/schema.sql` for fresh databases and `packages/hub/src/db.ts`
for an explicit transactional additive migration from schemas **5, 6 and 7 to 8**.
Preserve the existing schema-5 retired-operation-table migration. Create both
`deliveries_unread_session_seq` and `message_targets_message_id`, and advance
`PRAGMA user_version` to 8 within the same `BEGIN IMMEDIATE` transaction; any failure
rolls back both indexes and the version. Simulate failure while creating the second
index and verify that the first index does not remain committed. Reopening
schema 8 is an idempotent normal open; unsupported versions remain rejected. No row,
replay key, counter, receipt, session, board version or message is rewritten by the
index migration. Existing receipt updates maintain the partial unread index
automatically; message-target insertions maintain the target lookup index.

Index construction reads retained delivery and target history and consumes additional
disk space. Its startup cost is outside the per-page bound and can extend the
planned maintenance window. Qualify migrations on disposable representative history,
record their duration and size, and do not promise a short outage from small fixtures.
If creation fails, preserve logs and backups and leave deployment blocked for
inspection; do not remove records, bypass the indexes or erase the checkpoint.

Before cutover follow LOCAL_RELEASE_DEPLOY: stop/drain the updater, verify its lock,
and obtain the ordinary `VACUUM INTO` backups. Check the candidate image's fresh
database startup and additive migrations before production activation. After cutover
verify the running hub reports the intended release, the actual database has
`user_version = 8` and both expected indexes, and `quick_check` passes; verify
the pre-upgrade backup's original schema and integrity separately. Extend updater
qualification/fixtures for schema 8 and audit operator tooling with explicit schema
allowlists (currently `scripts/lib/test-data-cleanup.mjs` accepts only 6/7). Update
that guard and its tests only after confirming the additive indexes leave the tool's
existing replay-safety semantics unchanged; this design does not authorize executing
cleanup. Document the supported schema transition and fix-forward boundary in
LOCAL_RELEASE_DEPLOY and PROTOCOL alongside DESIGN §19.

Older hub binaries reject schema 8. Do not roll back the hub binary or restore an
old database after new operations; this could lose replay history. Retain the
running checkout and backups, investigate any blocked deployment and fix forward.
The table/index migration is separate from daemon/client capability compatibility:
old daemons may still speak the legacy RPC to the new hub, with the previously
documented large-backlog limitation.

## Acceptance and limits

| Requirement | Component and acceptance |
| --- | --- |
| Large-backlog reconnect completes | Repeat the isolated 200 x 60,000-character reproduction against candidate; all unique deliveries retained locally, completed synchronization, no churn, hub unread count unchanged |
| Bounded per-RPC work | Test 32-item and 512-KiB encoded boundaries, escaped/unicode bodies, many small messages, terminal empty pages and one over-size candidate error |
| Indexed page reconstruction | Verify all page-chain query plans, including unread range, highwater, message/author primary keys and targetsFor; long read gaps and large unrelated target history do not cause table scans or temporary sorts; malformed target count is bounded and rejected |
| Additive migration | Fresh schema 8 and 5/6/7-to-8 preserve rows, replay keys, sequence counters, receipts and boards; both indexes and version commit atomically, second-index failure rolls everything back, reopen idempotence and older-reader rejection are tested |
| No receipt conflation | Assert hub unread count, local acted flags and durable acted cursor unchanged after all pages; explicit later ACK remains the only advancement |
| Exact authorization | Other-host and ended/unavailable session attempts produce no bodies/events; old multi-session method still authorizes all sessions before emission |
| Safe interleaving | Live higher-sequence delivery before a lower page, concurrent reads, page replay and response loss produce no missing rows or repeated wake for local duplicates |
| Finite recovery | Continuous new sends do not move a captured highwater; a finite owner snapshot completes |
| Lifecycle fences | End/replacement/shutdown/reconnect during a held page rejects stale continuation; new owner gets an independent pass |
| All entry points | Both reconnect synchronization and reincarnation post-flush paths use the same bounded helper without flush recursion/deadlock |
| Mixed versions | Test all four old/new hub/daemon combinations and capability reset across reconnect; legacy limitation is explicit |

The controlled regression does not close historical #22 without field evidence.
Real-time push can still exceed the existing socket backpressure limit under a
separate sustained flood, and a paused client can still time out. Paging fixes the
resync-generated burst and gives reconnect finite progress under ordinary isolated
backlog conditions; it does not guarantee service under unbounded incoming load.
Day-long, physical subnet, unattended reboot and native Work gates remain open.

Before implementation, record the approved recovery contract in DESIGN §19 and
update PROTOCOL plus executable schemas together. Qualification uses the repository's
ordered build/typecheck/test and release checks, independent review and QA.
