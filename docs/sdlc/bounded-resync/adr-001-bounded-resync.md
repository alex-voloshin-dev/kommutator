# ADR 001: Bounded pull pages for delivery resynchronization

Status: proposed; pending the bounded-resync design review.

## Context

The current hub's resync RPC materializes and emits every retained unread body in
one synchronous call. A controlled 0.15.1 large-backlog reproduction repeatedly
crosses the WebSocket output guard, disconnects and replays the same retained
messages. Read receipts must not advance merely to make transport recovery progress.

## Decision

Add a negotiated `deliveries.resync.page` RPC returning one owned session's bounded
body page. Use at most 32 rows and 512 KiB of encoded result JSON, a fixed scan
highwater, and explicit transient cursor continuation. Do not emit a second stream
of notifications for these pages. The daemon durably deduplicates each complete
page before advancing its transient cursor; reconnect discards that cursor and
starts from existing durable acted state. Existing real-time push remains unchanged.

Keep legacy resync behavior for old clients, explicitly documenting that the fix
requires both hub and daemon updates. Optional hello capability advertisement
selects the new method without changing the local runtime contract or daemon schema.
Use a partial `deliveries(session_id, seq) WHERE state = 'unread'` index and a
`message_targets(message_id)` index so page selection and body reconstruction do
not scan unrelated retained history. This is a hub
layout change: migrate hub schemas 5/6/7 transactionally to schema 8, preserving
all rows and replay semantics. The index decisions are detailed in ADR 002.

## Alternatives considered

1. **Bounded asynchronous WebSocket writer for the existing notification stream.**
   This could repair old clients without changing the RPC. However, resync is
   synchronous today and constructs the entire backlog first. A safe implementation
   would need streaming database reads, bounded producer backpressure, ordering of
   asynchronous RPC completion, cancellation and host replacement, and a strategy
   for a 5-second RPC deadline while a slow reader drains. Queuing only row IDs
   remains unbounded unless production is also paused. This is viable broader
   server work, but is more invasive than explicit pull flow control for this fix.
2. **Pagination that still emits notifications and returns only a cursor.**
   This limits each burst, but mixes notification persistence with a separate
   control result. It requires proving all earlier notifications were ingested
   before accepting cursor progress, including future asynchronous handlers.
   Returning the bodies in the page makes the unit of validation and durable
   ingestion explicit and avoids another output burst on each page.
3. **Header-only resync followed by body lookup.**
   Smaller frames reduce pressure but the current local delivery/wake path expects
   complete message notifications. Existing `message.read` also marks receipts,
   so it cannot be used as transparent transport fetch. A new non-receipting fetch
   API plus changed adapters would expand the contract and request count.
4. **Raise/remove buffer limits, shorten history, or ACK received rows.**
   Larger buffers only move the threshold; unbounded buffers or collection expose
   memory exhaustion. Retention/pruning lacks replay-safe acceptance, and receipt
   changes would be semantically incorrect. These are rejected safety regressions.
5. **Limit the old method without continuation.**
   Old clients would believe synchronization complete and never request the tail.
   This silently loses delivery opportunities, so an explicit new method is needed.

## Consequences

- The new path's temporary resync work is bounded and each RPC is an ordinary
  request/response, at the cost of more round trips for a large backlog.
- Fixed highwaters provide finite passes without acknowledging content.
- Duplicate page fetches cost work but retain correctness across lost responses.
- The daemon must centralize both resync entry points and cancel stale passes.
- Old daemons remain vulnerable to the controlled legacy burst until upgraded;
  rollout and field claims must identify the actual daemon version per host.
- Live push pressure and historical environmental outages remain separate work.
- The two indexes require an additive hub migration and an index-build maintenance
  cost; older hub binaries reject schema 8, so rollout is fix-forward.
