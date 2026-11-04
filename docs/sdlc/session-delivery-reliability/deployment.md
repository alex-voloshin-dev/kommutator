# 0.10.0 release and local deployment

Observed 2026-11-04 UTC. Release tag v0.10.0 points to
`9700b2796e77becd1f5aef3147c5411c6cfd1184`; PR #4 merged as `ab0bfca`.
The numeric prerelease follows the existing distribution policy.

## Qualification

The final ordered workspace suite passed 488 tests (protocol 34, hub 174, agentd 99,
CLI 181). Full Linux x64 `release:check` passed, including 114 script tests, checksum and
license validation, clean-environment Claude/Codex startup, and synthetic client E2E.
Independent correctness/security/external reviews and QA approved. Final GitHub push,
pull-request and tag checks passed. Source/history and known-local-secret export scans
found no credentials. Earlier failed candidates and the diagnostic-stall regression are
recorded in qa.md; their archives were not published.

## Activation and observed behavior

The authorized release updater created hub/agentd SQLite backups, built the tagged image,
activated `kommutator-hub:release-0.10.0`, and restarted agentd. Its checkpoint is idle with
appliedVersion 0.10.0. Docker reports healthy; daemon 0.10.0 reports connected, health healthy,
no issues and an empty outbox. Runtime contract remains 3.

The developer session retained its hub ID, role and four subscriptions, including
kommutator-feedback and agentic-forge-feedback. Recovery advanced its incarnation normally.
The installed Codex 0.10.0 launcher successfully downloaded its checksum-pinned runtime.
An explicit tail watch on the existing developer session ran for 12 seconds and stopped
cleanly with no stdout events. An explicit replay from sequence zero returned 12 ordered,
unique, already-read feedback headers, all labelled untrusted and scoped to the requested
topic. A read-only before/after comparison found the recipient's delivery rows unchanged.
No synthetic production messages or registrations were created for this verification.

Both installed Claude and Codex plugin versions are 0.10.0. Existing live MCP processes
are not replaced by installation: this conversation's already-open client still reports
0.9.1 and remains contract-compatible. Restart/reconnect existing vendor sessions to load
new client code and approve changed hooks through the vendor UI if requested.

Feedback collection stayed active throughout. The maintainer was temporarily stopped to
prevent concurrent releases, then restored active/running with zero restarts observed.
The release deployment timer remains active. The isolated feature worktree was removed.

## Limits

CLI observation is live evidence; native Claude Monitor execution and Codex idle wake are
not established by it. Day-long, Windows reboot and physical-subnet gates remain open.
The historical shim exit cause remains unknown. Empty or interrupted hook observations
are unknown, not successful delivery. Watch has no persistent cursor and cannot promise
indefinite vendor monitoring or exactly-once handling.
