# ADR 001: Durable local observations for send and ack

## Context

The shim loses per-call context on IPC timeout; daemon `outcomes` is transient and successful
outbox rows disappear. Receipt replay preserves read state but does not preserve the first
attempt's transition counts. Existing hub replay authority must remain unchanged.

## Decision

Add a small durable local observation journal paired transactionally with existing outbox
admission/settlement, initially for MCP send and ack. A shim-generated correlation is never
a hub replay key or a resubmission facility. Expose bounded exact-operation lookup and
label receipt counts as the last confirmed hub attempt. Do not promise original counts
across a lost hub response. Keep board/CAS work outside this release.

## Alternatives considered

- **Shim-only bounded receipt cache:** smallest change; retaining late IPC replies could
  reconcile some timeouts without schema migration. It cannot follow queued operations
  after their immediate response, survive shim/daemon loss or atomically observe dequeue.
  Rejected because the requested recovery must survive daemon restart.
- **Bounded immediate enqueue response:** reduces head-of-line waits and gives a queued
  token quickly, but losing the response still loses correlation and adds no completed
  outcome evidence. It can be considered separately as latency work, not reconciliation.
- **Hub operation journal for all mutations:** can preserve exact original receipt counts
  and other mutation results across response loss. Requires new replay semantics, hub
  migration, ownership and retention contracts. Rejected for phase one because the local
  evidence gap can be fixed without making this larger compatibility commitment.
- **Inspect queue depth/current inbox or resend:** neither establishes the original
  operation's outcome; send can duplicate and ack can obscure original counts. Rejected.

## Consequences

One local migration and explicit admission/settlement transactions are necessary. Original
ack counts remain unknown after ambiguous replay. Hub availability, blocked queue recovery
and exact-once receipt history remain separate work. The user receives evidence rather
than a claimed failure or a speculative resend instruction.
