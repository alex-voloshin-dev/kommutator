---
type: release
feature: pending-registration
status: approved
review_decision: proceed
version: 0.12.6
changelog:
  - "Fixed: await already accepted matching manual Claude hook registration before initial identity binding."
  - "Fixed: reject late binding continuations after daemon shutdown or caller disconnect."
  - "Changed: collect bounded synthetic registration phases in a separate CI diagnostic sample."
breaking: []
---

# Kommutator 0.12.6 development preview

An unbound manual Claude shim can encounter its accepted hook registration before
agentd saves the local record. It now waits at most 250 ms for a fixed snapshot of
already accepted matching registrations, then rechecks process birth and fresh
registry identity. Tickets do not grant identity, start registration or permit
retries. Existing bound peers, hooks, Codex and generated plugin contexts retain
their previous behavior. Missing, conflicting, ended and superseded owners remain
rejected. Cancellation and daemon shutdown fence asynchronous continuations.

A separate opt-in CI lifecycle sample records fixed phase names and synthetic
owner labels for accepted hello, registration queue, birth checks, local save and
hub flush. Loader anchor validation catches stale instrumentation; primary test
errors are preserved if cleanup diagnostics also fail. Tracing is not an untraced
latency benchmark or a replacement for the release gate.

Internal hook deadlines remain 140/90 ms. The temporary process cap remains
300 ms and the target 200 ms. This addresses the controlled local-registration
race; it does not establish every historical #19 trigger, repair missing plugin
generation publication, or eliminate scheduler delays documented in #9.

## Qualification

Final independent release qualification passed 603 workspace and 140 script tests,
ordered build/typecheck, export integrity, clean-PATH smokes and synthetic E2E.
The new regression fails unchanged 0.12.5; candidate 0.12.6 passes the original real
200 ms delayed-registration process control without another hook or identity retry.
Independent correctness/security and external reviews approved the integrated change.
See review-change-2.md for retained earlier failures, invalid setup and limits.

## Not validated

Day-long reliability, unattended Windows reboot, physical allowed/denied subnet
clients, native Work/idle wake, other platforms and real model conversations after
plugin migration remain separate open gates.
