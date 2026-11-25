---
type: release
feature: reliability-nov25
status: released
version: 0.17.0
changelog:
  - "Fixed: reconnect backoff resets only after current-socket synchronization succeeds."
  - "Added: bounded request-timeout and hook failure reason/phase diagnostics."
breaking: []
---

# Kommutator 0.17.0 — recovery backoff and failure evidence

Published November 25, 2026 UTC: [0.17.0](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.17.0).
Tag commit `101b3142976c6d8d3644205464fc1b7974ab12c9`; PR #37 merged as
`d5efc10f1901038fce2b5071d266602136b3ddaf`. The minor version reflects additive optional
diagnostics; the preliminary 0.16.3 notice was corrected before publication.

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

Independent correctness/security/external review and QA passed. Ordered local build/typecheck
and 849 workspace tests passed. Full first-attempt hosted branch45537324305 and PR45537355089
passed on the exact tag head, as did tag45537677452. Both branch/PR secret scans and tag45537677532
passed. Each full gate includes849 workspace tests,161 script tests, audit, integrity,
clean-PATH and synthetic exported E2E. Develop review-decision returned proceed.

The subsequent local release gate failed three CLI cases (846 passed); scripts and export
were not reached. One exact-three-case diagnostic passed without establishing their original
cause. Retain [QA details](qa.md); no timeout/assertion relaxation was used. Separately,
export verification, clean-PATH and exported E2E passed locally. Public assets were downloaded
anonymously and byte/hash verified. Native clean Claude/Codex installs launched MCP0.17.0,
private setup200 and foreign-Origin403; these are synthetic-client installation checks.

Source/history secret scan passed. Artifact scan raw exit1 had two path-key license hash
findings, independently checked from the scanner's exact byte spans against manifest and
actual license bytes (the report's redacted Secret cannot itself be compared). No arbitrary
exception or credential exposure was introduced.

## Deployment

Pinned cutover completed normally after the announced 03:15 UTC window. Hub started
03:17:21 UTC; hub, shared daemon and actually reloaded Codex MCP are 0.17.0, contract4,
connected and caller active. Both current databases and VACUUM INTO backups passed
quick_check (daemon5/hub8), including both hub indexes. Timer restored; updater idle0.17.0.
Old blocked outbox644 remains, with aggregate degraded; no deletion/resend or reconciliation.
Existing live Claude MCP was not independently reloaded. Five hooks report trusted/enabled
without manual trust writes; this does not certify fresh hook execution.

The bounded 96-probe observer recorded94 expected401 and2 timeouts before activation.
Both timeouts had matching hub birth and D-state/jbd2_log_wait_commit; deployment-build
contribution and storage root cause are unmeasured. Only five post-activation probes passed.
The independently corroborated 03:08 incident precedes this observer and service restart.
See the rollout and availability evidence; no stable-service claim or issue22 closure.

## Not validated

Historical #9/#19/#22/#25 causes, remote unknown operation commits, safe blocked-queue
disposition, native idle wake/Work, other artifact platforms, day-long stability, physical
outside-subnet denial and unattended Windows reboot remain separate unresolved work.
