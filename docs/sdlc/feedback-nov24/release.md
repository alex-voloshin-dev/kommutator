---
type: release
feature: feedback-nov24
status: requalification-in-progress
version: 0.16.2
changelog:
  - "Fixed: registered Claude tracked mutations can reach durable local admission without a hub-dependent preflight."
  - "Fixed: unsuccessful Git project discovery no longer poisons later registrations."
  - "Fixed: validated cached management avoids installation writes on read-only filesystems, and watch reports local permission failures safely."
breaking: []
---

# Kommutator 0.16.2 — offline admission and client feedback repairs

## Fixed

- Existing registered Claude owners preflight tracked send/ack through local operation
  lookup instead of hub-dependent whoami. The same UUID, authority fences and single
  submission remain. This does not repair every historical unknown operation.
- Negative Git remote lookups are retried on later discovery. In-flight calls remain
  shared and positive results cached. Existing sessions, project topics and boards are
  not migrated; an existing Claude owner with a conflicting project needs a fresh session.
- Hosted management with an already initialized valid cache does not chmod, create an
  installation lock or download. Owner/private-mode/canonical-path/marker validation
  remains mandatory. Cold installs, MCP and hooks keep their existing paths.
- Watch gives fixed guidance for local EACCES/EPERM/EROFS. Real Unix socket access must
  still be authorized by the command environment; sandbox restrictions are not bypassed.

## Qualification

In progress. Baseline regressions and focused candidate checks are recorded in
[triage](triage.md), [project discovery](../project-negative-cache/implementation.md)
and [read-only management](../watch-readonly/implementation.md). Independent correctness,
security and external reviews approved the new product changes. QA found five operation
fixture failures in the first full integrated gate; investigation and complete
qualification remain required. Earlier 0.16.2 CI applies only to earlier recorded heads.

## Not validated

Historical remote send admission/commit is not reconstructed from unknown results.
No blind resend or blocked-outbox disposal is introduced. Underlying storage/network
availability, day-long use, physical subnet denial, unattended Windows reboot,
non-Linux-x64 bundles and actual native idle wake remain separate gates. Actual exported
read-only help and a denied local socket were tested; this is not proof of actual Codex
workspace-write socket access or a real model conversation across every vendor.

## Publication and deployment

Not published. No new maintenance window announced. Matching new archives, complete
release qualification, public download/native installation checks and local cutover
are still pending. The existing 0.16.1 services and old blocked outbox are unchanged.
