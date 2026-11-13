---
type: tech-design
feature: mutation-reconciliation
status: draft
review_decision: proceed
decisions:
  - "ADR 001: Durable local observations for MCP send and ack only"
  - "ADR 002: Owner-scoped lookup and bounded observation retention"
components:
  - "CLI MCP presentation and Claude local lookup path"
  - "Agentd mutation admission and outbox settlement"
  - "Registry observation table and schema migration"
  - "Protocol local request and result schemas"
risks:
  - "A lost hub acknowledgement cannot establish original ack transition counts"
  - "Expired or uncorrelated operations remain unknown"
  - "A full journal can reject new tracked mutations before enqueue"
  - "Local observation recovery does not fix hub availability"
---

# MCP mutation reconciliation

## Inputs and inferred requirements

No PRD exists. This design derives requirements from the authorized feedback follow-up,
the [research brief](../runtime-reliability-followup/research-brief.md), the open
[incident](../runtime-reliability-followup/incident.md), DESIGN §19 and current source.
Reports describe send timing out before a recipient replies, and ack timing out before a
later ack reports either `already_read` or `marked_read`. Those reports demonstrate an
uncertain caller outcome, not a reproduced cause or proof of message loss.

1. Give each new MCP send/ack a stable correlation and expose it when IPC times out.
2. Let the same authorized owner query that operation without hub connectivity or replay.
3. Preserve daemon-authoritative send replay keys and all existing receipt/lifecycle rules.
4. Retain useful observations across daemon restart, with explicit crash ambiguity.
5. Bound new storage and result sizes without deleting outbox work or replay authority.
6. Preserve old clients and hubs; avoid changing board, hook or lifecycle mutation paths.

Requirements 1–2 map to the MCP wrapper, local status method and owner checks;
3–4 to registry transactions and flush settlement; 5 to retention/admission;
6 to additive local schemas and the explicit phase-one boundary.

## Current behavior

`packages/cli/src/ipc-client.ts` stops waiting after five seconds and discards late
responses for that RPC ID. It never retries a submitted mutation. `mcp.ts` currently
returns the exception text without request-specific correlation.

`core.ts` enqueues send/write, then awaits the shared flush. A stall in unrelated earlier
work can outlast the IPC budget. The daemon removes a completed outbox entry transactionally,
then saves the answer in its in-memory `outcomes` map (bounded to 256). This map is neither
a durable observation nor a lookup API. Its absence, queue depth and transport closure
cannot prove non-admission or failure.

Send has a daemon-generated `idempotency_key`; receipts have no hub operation replay
journal. Repeating a receipt can change the count distribution without changing the final
read state. `ClaudePluginClient.call` also makes a remote `whoami` request before every
call; leaving this preflight in a local lookup would defeat outage reconciliation.

## Scope and interfaces

Phase one covers MCP `send` and explicit MCP `ack` only. Exclude boards, topic mutations,
`read`, hook acknowledgements, human CLI send, session mutations, queue cancellation and
blocked-row disposition. No mutation retry tool or automatic shim replay is introduced.

The shim generates a fresh UUID `operation_id` for each validated invocation, before
client resolution or IPC submission. It is not a public mutation argument, not an MCP
JSON-RPC ID, and not a hub replay key. Send/ack use new local IPC
`operation.submit({ operation_id, method, params })`, restricted to `message.send` or
`receipt.mark`; agentd unwraps it before hub validation/forwarding. Strictly validate the
envelope and each supported mutation's local params. Callers still cannot choose `session_id`,
`idempotency_key`, `op_id`, registration IDs or lifecycle fields. Reject malformed and
unexpected local fields. A retained ID collision is rejected before enqueue; IDs must never
be reused, including after observation expiry. This API is correlation, not idempotent
mutation submission. There is deliberately no retained-ID resubmission endpoint.

Successful send/ack retain their existing payload and add `operation_id`, except that
tracked send recovery may return the typed compact result with `deliveries_omitted: true`
instead of a delivery map. The tracked submit schema explicitly accepts both full and
compact send variants; legacy untracked send responses keep their existing shape. An error after
invocation preparation includes the ID and fixed guidance to call `operation_status`;
an IPC error alone reports `outcome: unknown`, never `failed`, `queued` or `sent`.
Schema validation before invocation preparation remains an ordinary validation error.
Use fixed error categories rather than persisting arbitrary transport error text.

Add MCP `operation_status({ operation_id })`, implemented by local-only IPC
`operation.status`. It accepts one UUID, not a session selector, and returns one bounded
observation. It does not flush, call the hub, change receipts, resend or enumerate another
owner's operations. States are:

| State | Evidence and meaning |
| --- | --- |
| `unknown` | No retained observation authorized for this owner. Could be non-admission, expiry, legacy call, unavailable owner or lost state; never proof of failure. |
| `queued` | Atomic local admission exists and corresponding outbox work remains. Hub commit may already have occurred if its acknowledgement was lost. |
| `confirmed` | Agentd durably recorded a validated successful hub response for this operation. Send includes message ID; ack includes the last confirmed attempt result. |
| `blocked` | Outbox retains the operation with a recorded error and will not automatically progress it under current rules. This does not prove that no prior attempt committed. |

Known states include `operation_id`, method (`message.send` or `receipt.mark`), admission
time and observation time; confirmed includes the bounded typed result. Blocked uses a
safe error code/category, not the body or raw RPC error text. Unknown is the same shape
for foreign and missing IDs. Failed owner binding remains its existing identity error,
with no operation existence information.

The presentation must say send confirmation means hub storage/routing, not recipient
read. An ack result's counts describe its **last confirmed hub attempt**. They are never
advertised as the original attempt's exact transition counts, including when they are
`already_read`. Older hubs can confirm processing with `ok: true` and absent counts;
those counts remain unknown. Status results do not imply current mailbox state.

## Persistence and transactions

Add `mutation_observations` to the private registry and bump `STATE_SCHEMA_VERSION`
from 3 to 4. Keep the hub schema and hub methods unchanged. Suggested columns are:
operation UUID primary key, local record key, owner snapshot JSON, optional admitted hub
session ID, method, outbox ID, created/updated times, state, and bounded result/error JSON.
The journal stores no message body, acknowledgement ID array, credential or new replay key.
Outbox remains the sole mutation/replay authority.

Admission validates parameters and current ownership first. One synchronous registry
transaction checks capacity/collision, allocates the existing daemon replay key where
needed, enqueues the mutation, and inserts its observation. Neither half can survive alone.
After commit the existing flush behavior continues. Do not alter the public send fast path
or claim that returning early solves all uncertain admission cases.

On a successful hub response, validate the expected send/receipt result before accepting
it as confirmation. In the same transaction that removes the outbox row, persist the typed
result and mark the observation confirmed. The immediate caller must use this durable
observation if its in-memory response cache is absent. A shared flush can exceed 256
same-owner completions or run beyond retention, evicting both sources before a waiting
submit returns. After that wait, `queued` requires the exact matching outbox row to still
exist; if neither a retained result nor the matching outbox row exists, return `unknown`
with `operation_id`, never infer `queued` from missing result evidence. Apply the same
evidence rule to lookup, including inconsistent/missing rows. On a hub RPC error, atomically
record the safe blocked observation and the existing outbox error. Transport exceptions
leave the operation queued. Missing-session and seven-day replay-horizon blocks must
also update their linked observations. Existing untracked outbox rows retain their behavior.

Flush settlement addresses the observation linked to that exact outbox ID; it cannot
overwrite a different operation based on a reused session key. A result validation error
must not dequeue the entry or manufacture confirmation. Retirement during a flush may
prevent the original tool from receiving the result; its observation still records what
the daemon actually learned, without granting a retired caller lookup access.

## Owner and restart boundary

Existing `currentOwner` pins process ownership only for Claude; Codex's existing
`peer.key` alone cannot authorize tracked operations after another shim replaces the
same root's local record. Add an immutable tracked-operation owner snapshot to each
eligible shim connection at its original `ipc.hello` admission/binding, before awaiting
flush or other asynchronous work that can replace that owner. Capture local key, vendor,
root/conversation ID, owner PID, observed process birth, owner generation (including
absence), lifecycle epoch and the hub session UUID when already known. Use the owner
established for that hello, not a fresh successor record obtained after its wait.

Tracking is enabled only after hello completes successfully and its captured owner
still matches. Failed/incomplete hello, missing required PID/birth evidence or absent
snapshot cannot issue tracked submit/status. Never lazily pin at the first tracked call
or re-pin an existing peer after ownership changes. Legacy methods keep their existing
behavior; this additional fence is required for the new tracked-operation surface.

Tracked submit admission, its return after flush, and status lookup must check the
connection snapshot against the current record as well as existing `bind/currentOwner`
checks. Repeat the comparison after any asynchronous boundary before returning operation
data. A stale connection fails with the existing identity error and no operation details,
even when it knows a successor's operation UUID. Lookup additionally compares the
observation's admitted owner snapshot and hub session UUID against that verified owner.
Where a send was admitted before registration,
keep its local owner snapshot and fill its session UUID only from that exact record's
accepted registration, never from a caller selector or a replacement record.

A normal daemon restart preserves these owner facts; a hub `incarnation` increment from
daemon recovery is not by itself a new local conversation. Record incarnation for diagnostics
if useful, but do not use it as the sole authorization key or make restart recovery impossible.
A new process, ended/revived lifecycle epoch, different conversation/generation, reused
handle or different session UUID cannot read the previous operation. No owner guessing,
cwd fallback, ancestor environment binding or Codex fork access is added.

For `operation.status` only, Claude's wrapper resolves current on-disk generation, prepares
the compatible local client, uses its pinned shim connection and checks generation again
afterward, but skips remote `whoami` and hook registration/revival recovery. The daemon
still performs its ordinary local binding/owner checks. An ended or unbound owner fails
explicitly. Codex still resolves each call through validated root metadata. Status is
not routed through the unbound CLI diagnostics connection. A fresh connection still runs
existing `ipc.hello`, which can await registration/flush work. Lookup therefore has no hard
availability guarantee: hello timeout or unavailable ownership yields an explicit lookup
error/unknown outcome. Do not weaken hello authority to avoid this delay. Once bound,
the status handler itself does not wait for hub transport.

The owner portion of the connection snapshot is immutable. Its initially absent hub
session UUID may attach exactly once from daemon-owned registration of the same local
key after all pinned owner facts still match. This attachment is allowed after the
hello flush or after an offline hello later acquires its registration; it is not a
refresh of PID, birth, generation, epoch or root. Once attached, a different UUID is
rejected. No caller-supplied UUID participates. Test initial online registration and
offline binding followed by registration. Apply the same rule to observation attachment.

### Pure plugin compatibility preparation for lookup (2026-11-12)

`operation_status` passes its method context through the actual MCP client source and
Claude preparation path. Both plugin profiles validate compatibility with the additive
CLI-only `daemon.runtime` RPC: strict empty params, bounded version and runtime-contract
fields only. This RPC performs no retirement reconciliation, flush, hub request or
registration. Its client disables lazy startup and hub waiting. Unsupported old daemons
fail clearly without falling back to `daemon.status` or submitting a mutation.
Normal plugin preparation keeps its existing diagnostics/startup behavior. Lookup still
checks local conflicts, Codex call-root metadata and Claude on-disk generation. An
`operation.status` socket reconnect also suppresses lazy daemon startup, including clients
originally constructed for ordinary mutations. Existing hello ownership rules still apply;
a fresh bound connection can await ordinary hello work, with no availability guarantee.

### Local lookup scheduling and initially unbound connections (2026-11-12)

After a successful `ipc.hello` response, production IPC dispatches only
`operation.status` on a separate per-socket serial lookup lane, bounded to 16 outstanding
lookups. All mutations and other methods retain their existing ordered queue. Before
hello completes or after it fails, lookup cannot bypass that queue. Each lookup still
runs normal binding and immutable tracked-owner checks, including retirement fences;
transport scheduling supplies no identity authority. This lets a timed-out submit remain
pending while the same connection observes its queued state. Lookup overflow fails with
a fixed error, without dispatch or mutation.

The client remembers an explicit `bound: false` hello result. Before sending a tracked
submit only, a single-flight preparation can replace that idle unbound connection with
one fresh hello. It never changes a peer's pinned owner or replays a submitted mutation.
If another RPC is pending, any RPC timed out on this connection, or the fresh hello
remains unbound, fail before dispatch. A bounded per-connection timeout fence is
conservative even after a late reply; it resets only on socket closure. All calls await
shared preparation, and the idle check and connection replacement are synchronous.
An absent legacy `bound` field does not trigger this recovery; dedicated operation
methods still report unsupported-daemon errors without fallback. Closing an idle shim
connection uses existing disconnect behavior and does not retire its logical owner.
`operation.status` never triggers this preparation or registration/revival recovery.

Retention and capacity queries inspect indexed metadata only, never materialize stored
result blobs. Confirmation pruning runs only for tracked settlement, not legacy hook
receipts or lifecycle settlement. Expired lookups remain unknown even when no admission
or settlement has triggered physical eviction.

## Crash and timeout cases

| Interruption | Result on authorized lookup |
| --- | --- |
| Before admission transaction commits | Unknown; do not infer non-admission from a timeout alone. |
| After admission, before sending to hub | Queued; existing daemon replay owns progress. |
| Hub commits, response is lost | Queued until existing replay confirms or blocks. Send reuses the same daemon key. |
| Ack commits, response is lost, daemon replays | A later confirmation reports that replay attempt's counts; original transition counts remain unknowable. |
| Hub response received, local settlement transaction not committed before crash | Existing outbox survives and replays; no invented confirmation. |
| Local confirmation committed, IPC reply lost | Confirmed survives daemon restart for the same authorized owner. |
| Owner retires or changes while waiting | Existing identity fence rejects response/lookup; successor cannot inspect predecessor's observation. |
| MCP process or outer MCP response is lost before caller learns the ID | No recovery promise. No content matching or global operation listing is added. |

Neither a blocked response nor a transport exception proves a send never committed:
an earlier attempt may have committed and its response been lost. No automated cleanup
or suggested blind retry follows any state.

## Bounds and compatibility

Retain terminal confirmed observations for at most 24 hours and at most 256 per owner,
with a global limit of 4,096 observation rows. Expired/oldest confirmed rows can be evicted
before admitting new tracked work. Queued and blocked observations are not evicted while
their outbox row exists. If the global limit is occupied by unresolved observations, reject
new tracked mutation admission before enqueue with a fixed capacity error. This is explicit
backpressure, not a reason to delete pending work. Each stored result's serialized UTF-8
JSON must be at most 64 KiB (65,536 bytes). A send result within the limit has typed
`{ id, deliveries, replayed }` fields. If it exceeds the limit, store the typed compact
variant `{ id, replayed, deliveries_omitted: true }`, with no `deliveries` field; the
result schema must distinguish these variants. Ack retains typed `{ ok: true, counts? }`
with the existing bounded counts schema. Never truncate JSON or infer omitted deliveries.

Deleting an observation deletes no outbox, message, receipt, registration journal or hub
replay key. Missing observations return unknown, not a retry authorization. Once an
observation is evicted its correlation cannot be recovered; it is not reusable by the shim.
This bounded diagnostic eviction does not enable `kom hub prune` or alter seven-day replay.

Migration creates the table without rewriting old outbox params or fabricating historical
outcomes. Existing clients use original methods and follow the current path. Old daemons
reject `operation.submit`/`operation.status` as unsupported; report a clear local upgrade
requirement and never fall back to the original mutation. Runtime contract 3 can remain:
dedicated methods prevent old daemons silently ignoring a correlation field while admitting
untracked work. Never fall back by submitting again without correlation. Old hubs remain compatible because
all additions are local. A schema-4 database cannot safely be opened by an old daemon;
preserve the current database and prefer a schema-4-compatible fix forward. A verified
pre-upgrade backup alone is not safe rollback: restoration additionally requires proof
of no post-snapshot admissions, or a separately reviewed lossless reconciliation
procedure. Never automatically restore a snapshot or downgrade the schema.
An already bound read-only lookup must remain local while the hub is offline.

## Validation required before release

- Daemon behavior tests: delay the hub response beyond IPC timeout, then observe exact
  send confirmation with one hub message; likewise preserve ack's confirmed counts.
- Complete more than 256 same-owner operations in one shared flush before the earliest
  submit resumes, evicting its observation and in-memory result. Its removed outbox row
  must produce `unknown` with its operation ID, never `queued`. Cover the same boundary
  using elapsed retention, and separately prove queued requires the matching extant row.
- Exercise the exact 65,536-byte result boundary and oversized-send compact variant,
  including tracked submit recovery after the in-memory outcome is evicted;
  omitted delivery details remain explicit and each persisted result validates its schema.
- Drop a committed hub response and recover through the existing outbox. Prove send
  replay identity; prove ack reports last confirmed attempt counts rather than original counts.
- Restart from registry snapshots at admission and settlement boundaries; verify atomic
  outbox/observation persistence and normal same-owner recovery.
- Offline lookup, including Claude plugin wrapper, must make no hub request or hook
  registration recovery. Test stale generation, retired peer, process replacement, another
  Codex root, fork metadata and reused handles/session keys without existence leakage.
- Bind two distinct Codex shim processes successively to the same root while the first
  has a tracked submit awaiting flush. The first connection must neither receive its
  pending operation result after replacement nor query the successor's known operation
  UUID. Verify the snapshot was captured before hello's flush wait, never at a later
  query; failed/incomplete hello cannot track and an old peer never re-pins.
- Malformed correlation, repeated retained UUID, invalid destinations and full capacity
  reject before enqueue. Exercise retention bounds and verify outbox/replay records survive.
- Migrate versions 1–3 without changing queued payloads; test old clients and old hub
  `ok: true` receipts with absent counts, unknown legacy IDs and unsupported daemon rejection.
- MCP tests verify correlation in success/error paths, unchanged peer-consent descriptions,
  no automatic resubmission and unchanged legacy mutation behavior.

Then run the repository's ordered build, typecheck and tests and `pnpm release:check`.
The design was independently reviewed before implementation. Implementation review and QA
are recorded in [review-change-3](review-change-3.md); release qualification is a separate gate.
Day-long, independent subnet, Windows reboot, vendor wake and availability incident gates
remain open. `review_decision: proceed` records the approved design boundary.
