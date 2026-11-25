---
type: release
feature: local-rebind
status: proposed
version: 0.17.1
changelog:
  - "Fixed: established Claude reconnects no longer await unrelated outbox synchronization."
  - "Fixed: lifecycle fixtures retain primary failures when cleanup or diagnostic output fails."
breaking: []
---

# Kommutator 0.17.1 candidate

The release workflow proposes patch0.17.1 from the actual changes since0.17.0.
No publication, service update or final qualification is claimed yet.

A previously registered, explicitly identified positive-generation Claude owner can
complete a fresh IPC hello and local operation lookup without waiting on another owner's
stalled hub response. Process birth, owner generation/lifecycle/session UUID, context,
durable end-marker and disconnect/shutdown checks remain. Pending owner lifecycle writes,
new registrations, hook callers, manual generation-zero and Codex keep the original path.
This does not eliminate hub dependencies from reads/mutation settlement or prove any
historical unknown operation uncommitted. Never blindly resend.

Lifecycle fixtures preserve both primary and cleanup errors and bounded pre-cleanup/
pre-kill evidence; a throwing diagnostic sink cannot change the outcome. Runtime hook
140/90ms timers and temporary strict300ms full-process limit remain unchanged.

## Investigation limits

Local0.17.0 log inspection03:17:28–15:40:07UTC found no new heartbeat/connection error
entries, only one obsolete shim retirement. Eighteen later bounded loopback probes all
returned expected unauthenticated401. These are not continuous, remote-client or day-long
qualification; prior storage waits and issues9/19/22/25 remain open.

## Not validated

Historical outage causes, safe blocked-queue disposition, native idle wake/Work, physical
outside-subnet denial, unattended Windows reboot and other platforms remain open gates.
