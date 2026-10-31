---
title: Protocol authority and identity boundaries
type: note
tags: [protocol, identity]
---

# Protocol authority and identity boundaries

[schemas.ts](../../packages/protocol/src/schemas.ts) defines Methods, Notifications,
Session/Message/StoredMessage/BoardEntry, limits and the 1 MiB frame maximum.
[results.ts](../../packages/protocol/src/results.ts) defines selected result schemas;
it does not yet provide a result for every method. [PROTOCOL.md](../PROTOCOL.md) indexes
the intended wire contract; [DESIGN](../DESIGN.md) defines behavior.

The implemented IPC handshake pins a connection to one session; agentd stamps session_id and
the hub derives authorship and checks membership. The hub implements these checks and
transactional replay for reg_id, idempotency_key and op_id. The registration journal
returns the original snapshot on delayed replay without changing current session state.
The production binding uses the vendor session ID, then PID or a single unbound cwd
candidate only when no vendor ID exists. Ended bindings cannot switch identities.
Launch-scoped endpoint/token/mode/policy reset on revival or process replacement.

[headers.ts](../../packages/protocol/src/headers.ts) uses Unicode code points for
previews/injection: at most five headers and 4,000 code points including the trailer.
Other Zod string limits use JS string length. For hook injection, only packHeaders.shown
may be marked read; explicit ack(ids) and message.read remain separate receipt transitions.
Receipt bookkeeping is unread/read; socket write/close alone cannot establish read.

Headers expose the stored hub wake decision. inbox.list(waking_only) filters on it;
deliveries.resync re-emits unread rows above each session's acked sequence and rechecks
current DND without allocating another sequence or marking anything read. Stop must also
recheck current DND. The adapter/scheduler are wired; a durable per-sequence ledger
prevents duplicate wake and avoids skipping holes in the resync cursor.

board.history pages newest first, at most ten versions, with an exclusive version cursor.
RPC results above 1 MiB UTF-8 return -32011; narrow or page the query rather than accepting
truncation. See [PROTOCOL](../PROTOCOL.md) and [DESIGN §19](../DESIGN.md#19-implementation-decisions-and-open-questions).
