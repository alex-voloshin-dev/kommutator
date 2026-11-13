---
title: Protocol authority and identity boundaries
type: note
tags: [protocol, identity]
---

# Protocol authority and identity boundaries

[schemas.ts](../../packages/protocol/src/schemas.ts) defines Methods, Notifications,
Session/Message/StoredMessage/BoardEntry, limits and the 1 MiB frame maximum.
[hello.ts](../../packages/protocol/src/hello.ts) owns the canonical IPC hello schema,
vendor enum and protocol version. The root method table references the same schema;
`@kommutator/protocol/hello` lets early hook authority avoid unrelated RPC schemas.
[results.ts](../../packages/protocol/src/results.ts) defines selected result schemas;
it does not yet provide a result for every method. [PROTOCOL.md](../PROTOCOL.md) indexes
the intended wire contract; [DESIGN](../DESIGN.md) defines behavior.

The implemented IPC handshake pins a connection to one session; agentd stamps session_id and
the hub derives authorship and checks membership. The hub implements these checks and
transactional replay for reg_id, idempotency_key and op_id. The registration journal
returns the original snapshot on delayed replay without changing current session state.
Claude binding requires the vendor session ID plus observed owner PID/process birth.
Concurrent processes resuming the same vendor ID receive independent hub identities;
the public vendor ID remains correlation data. Without a vendor ID, only a unique
same-owner match is allowed; cwd cannot substitute for ownership. Cold registration and
cleanup are owner-scoped. A unique prior owner may be resumed only with positive exit or
PID-reuse evidence and matching cwd/project; ambiguity produces a new registration.
Bound peers cannot follow an ended or replaced owner; ownership is rechecked after async
probes, flushes and reads. A live hook-only owner does not require a native socket. Duplicate resumed owners sharing a
native endpoint use hook delivery while the endpoint is ambiguous. See the
[ownership implementation evidence](../sdlc/claude-session-identity/implementation.md).

Codex roots use exact per-call MCP metadata (`sessionId`/`threadId`); inherited environment
IDs and cwd do not establish identity. Hooks bind existing roots and the shim owns
liveness. Fork MCP calls are rejected. Launch-scoped endpoint/token/mode/policy reset on
revival or process replacement. The plugin daemon compatibility contract is 4.

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

Claude in-process resume resolves the current owner-scoped hook generation rather than the
MCP launch environment ID. Immutable registration generations and end tombstones survive
hook termination; local daemon state schema 2 retains the generation fence across restart.
Older same-owner conversations are retired before the successor registers. See
[DESIGN recovery contract](../DESIGN.md#claude-in-process-conversation-changes).

Linux process birth now uses boot ID and exact proc start ticks, independent of timezone.
Schema 5 retains incomparable legacy owners without assuming death; coordinated hooks/MCP
upgrade and a new client process are required. Claude hello requires runtime_contract 4.
See [[../../sdlc/reconnect-authority/tech-design|reconnect authority design]].
