---
type: release
feature: ack-diagnostics
status: approved
version: 0.12.1
changelog:
  - "Fixed: expose acknowledgement counts so an unmatched ack is distinguishable from marking messages read."
  - "Changed: temporarily allow hook process checks below 300 ms while reporting the original 200 ms target."
  - "Added: regression coverage for a 130-message unread backlog and acknowledgement identity boundaries."
breaking: []
---

# Kommutator 0.12.1 development preview

The maintainer authorizes warranted maintenance, validation, publication, local service updates
and announcement without a separate per-release confirmation. This patch improves diagnostics;
it does not claim to fix the unconfirmed unread-replay report.

## Fixed

`ack` retains `ok: true` and adds distinct-ID counts: `requested`, `matched`, `marked_read`,
`already_read`, and `unmatched`. Unknown and foreign-recipient IDs remain indistinguishable.
No receipt is reverted, duplicate IDs do not inflate counts, and repeated acknowledgements
report already-read messages. Legacy hubs may omit counts; queued writes have no committed
hub counts. No schema migration or runtime-contract bump is needed.

## Changed

Hook process checks temporarily accept durations below 300 ms. The original 200 ms target
and actual measurements remain visible, including in passing CI runs. Internal runtime timers
are unchanged; issue #9 remains open. A 130-message handler-level regression verifies backlog
pagination and correct-recipient acknowledgement/read behavior.

## Validation

See the accompanying review record and release publication notes for completed checks and
observed deployment. Historical measurements retain their original thresholds.

## Not validated

The original reporter's live Claude acknowledgement arguments and identity were unavailable;
its claimed replay cause remains unconfirmed. In-memory conformance tests do not prove live
vendor binding or network/reconnect behavior. Physical subnet clients, Windows reboot,
day-long usage, Work desktop/native idle wake and other platforms remain open gates.
