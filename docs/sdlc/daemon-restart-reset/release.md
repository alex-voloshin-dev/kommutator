---
type: release
feature: daemon-restart-reset
status: approved
version: 0.12.3
changelog:
  - "Fixed: confirm daemon termination after shutdown connection reset before starting one replacement."
  - "Fixed: bound the entire shutdown confirmation to two seconds and cancel pending management connections."
breaking: []
---

# Kommutator 0.12.3 development preview

Daemon restart now tolerates a shutdown connection reset or explicit stopping response
as a transition, then confirms listener absence before starting a replacement. Unknown,
authorization and malformed-response failures remain fail-closed. A single two-second
budget covers connection, handshake and confirmation; pending sockets are closed on timeout.
The existing lazy-start and single-instance guard avoid duplicate spawn attempts.
No database schema, protocol or runtime compatibility contract changed.

ROADMAP now separates implemented behavior, immediate reliability work and outstanding
acceptance. Initial hook phase measurements are recorded in spikes/RESULTS.md. One
untraced sample exceeded the 200 ms target; its cause is unknown. Issue #9 remains open
with the temporary 300 ms cap and unchanged internal timers.

## Validation

Independent correctness, security and external review approved. Final qualification and
its exact counts are recorded in qa.md; public installation and deployment evidence will
be recorded after publication, rather than inferred from local tests.

## Not validated

The restart reset is reproduced with a disposable Unix socket fixture, not by forcing
production failure. Stalled socket-connect is not directly injected; stalled hello and
replies are covered. Real model conversations, native wake/Work, other platforms,
physical-subnet access, unattended Windows reboot and day-long reliability remain open.
