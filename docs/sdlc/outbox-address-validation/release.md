---
type: release
feature: outbox-address-validation
status: approved
version: 0.12.2
changelog:
  - "Fixed: reject malformed recipient addresses before adding a message to the durable outbox, including offline sends."
  - "Fixed: apply the shared address grammar to MCP, raw agent and human send paths without changing historical message reads."
  - "Fixed: retire the captured Claude SessionEnd generation before loading delivery code, preserving stale-generation fencing."
  - "Fixed: reconcile durable end markers after interrupted hook notification, including offline replay and terminal retirement after liveness recovery."
breaking: []
---

# Kommutator 0.12.2 development preview

Invalid syntax such as a bare topic name now fails before message persistence. Use
`topic:<name>`, `<name>@<host>`, `@role:<role>` or `all`. Addresses are validated, not guessed
or rewritten. Valid syntax still requires hub-side membership and recipient checks;
syntax validation does not guarantee that a recipient exists or a message can be delivered.

Historical message records remain readable. Existing rejected entries are not automatically
removed or replayed. No database migration or runtime-contract bump is required. This patch
is covered by the maintainer's standing authorization for warranted fixes and releases.

## Operational recovery

The operator independently verified that rejected local entry 354 duplicated a message
already published by the same author to the canonical topic. A private `VACUUM INTO` backup
passed integrity checks; only the exact unchanged rejected row was removed, without resend.
This was a scoped recovery, not a general queue-pruning feature or automatic retry policy.

## Validation

Completed checks are recorded in the accompanying review and publication notes.

## Not validated

Physical subnet clients, Windows reboot, day-long reliability, Work desktop/native idle wake
and other-platform execution remain separate acceptance gates. Hook latency issue #9 remains
open under the approved temporary 300 ms process-test threshold; internal timers are unchanged.

## Known reliability observation

One local process test left Claude authority active after SessionEnd despite meeting the
latency cap; two focused repeats passed unchanged. Root cause is unconfirmed and tracked
in [issue #13](https://github.com/alex-voloshin-dev/kommutator/issues/13). The candidate now retires local authority before importing delivery code. The daemon also reconciles the durable marker at startup, sweep, status/list requests and
before owner recovery. This supplies a separate durable recovery path when hook notification
is interrupted. Earlier failing observations are retained in the review record.

One subsequent aggregate check passed workspace/script tests and export smoke but reached
a 2-second synthetic owner-hook watchdog in the final E2E. A diagnostic focused export run
passed; the original phase and cause were not recorded. Time limits remain unchanged.
