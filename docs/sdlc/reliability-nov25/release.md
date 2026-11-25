---
type: release
feature: reliability-nov25
status: draft
version: 0.17.0
changelog:
  - "Fixed: reconnect backoff resets only after current-socket synchronization succeeds."
  - "Added: bounded request-timeout and hook failure reason/phase diagnostics."
breaking: []
---

# Kommutator 0.17.0 — recovery backoff and failure evidence

Candidate only; not yet published or deployed. `release-summarize` selected a minor
version because optional hook diagnostics are additive functionality. The preliminary
maintenance notice named 0.16.3; correction b3fb8b42-c22b-42ba-b06a-8e05c51fef6e names
0.17.0. Earliest maintenance is November 25, 03:15 UTC, conditional on qualification.

## Fixed

Repeated hello success followed by synchronization failure no longer pins reconnects
at 100 ms. The existing exponential delay grows to its existing 10-second cap and resets
only after the current open socket finishes synchronization. Stale/stopped completions
cannot reset another connection. Synchronization can still use the socket while running.

## Added

- Hub timeout evidence identifies the triggering allowlisted method, local request ID,
  connection epoch, elapsed time and pending count. Collateral disconnects remain distinct;
  an unknown mutation result is never proof of non-commit. Diagnostic sink failure cannot
  interrupt timeout rejection/termination.
- Private hook observations optionally include fixed reason/phase fields, distinguishing
  registration rejection, IPC deadline, connection/hello phase, permission and other bounded
  categories. Old records/outcomes remain compatible; raw errors, payloads, endpoints and
  secrets are excluded. A close during hello reports hello, not an undispatched operation.

No wire schema, runtime contract, database schema, replay, receipt or 140/90 ms hook deadline
changes. The full-process temporary test threshold remains strictly below 300 ms.

## Qualification

Pending integrated QA and release gate. Baseline failures and independent reviews are recorded
in implementation/review artifacts. No runtime deployment or historical root cause is implied.

## Not validated

Historical #9/#19/#22/#25 causes, remote unknown operation commits, safe blocked-queue
disposition, native idle wake/Work, other artifact platforms, day-long stability, physical
outside-subnet denial and unattended Windows reboot remain separate unresolved work.
