---
type: release
feature: local-rebind
status: proposed
version: 0.17.2
changelog:
  - "Fixed: established Claude reconnects no longer await unrelated outbox synchronization."
  - "Fixed: lifecycle fixtures retain primary failures when cleanup or diagnostic output fails."
breaking: []
---

# Kommutator 0.17.2 candidate

The release workflow proposed patch0.17.1; its unpublished immutable tag remains retained.
The corrected test-contract candidate advances to0.17.2, without rewriting that tag.
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


## Candidate0.17.1 qualification interruption

The full local release gate and exact-head branch45649459503/tag45649789658 passed.
PR45649636476 failed the unchanged non-stalled Stop process test: output and all three
IPC methods were observed, but observations were empty at168.216ms. This is not a
failure of the new local-rebind regression. Source explicitly permits interruption of
best-effort diagnostic persistence at the140ms entrypoint deadline; the old test demanded
a terminal record regardless. A controlled reproduction and separate completed/interrupted
contract coverage are required; no blind rerun, relaxed deadlines or publication.
Tagv0.17.1 remains immutable/unpublished. GitHub draft creation returned502 and the
release does not exist. Timer restored and tentative16:05UTC service work deferred.
