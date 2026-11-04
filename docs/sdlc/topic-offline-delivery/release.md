---
type: release
feature: topic-offline-delivery
status: approved
version: 0.8.2
changelog:
  - "Fixed: retain topic messages for existing subscribers while their session is gone."
  - "Fixed: recover pending deliveries after reincarnation on the existing hub connection."
breaking: []
---

# v0.8.2

Topic subscriptions now survive session absence. Messages sent while an existing member
is gone are retained unread and recovered after reincarnation. The hub does not push to
gone sessions. Recovery waits for queued policy updates, preserving current DND behavior.
Direct handles, roles and all addressing retain their live-only behavior.

Authorization is captured at send time. Leaving before a send excludes the subscriber;
joining later grants no historical messages. Pre-upgrade omissions are not automatically
backfilled because current membership does not prove membership at the historical send.

Update both hub and daemon. No database schema or runtime contract change is required.

## Validation

Correctness/integration, security and external review approved the fix; independent QA
added SQLite persistence coverage. Workspace build/typecheck passed and 456 cases passed
across full and final targeted runs. Initial CLI process timing failures passed isolated
and subsequent full runs. The full Linux x64 release:check passed, including 456 workspace tests, release-script
tests, export verification, clean-environment startup and synthetic client E2E. Deployment
is tracked separately.
Source and known-local-secret scans passed. The export scanner flagged only two runtime
checksum manifests; their values were verified against the actual payload hashes.

## Not validated

Synthetic recovery is not a live Claude/Codex resume observation. Day-long usage, Windows
reboot and physical subnet gates remain open. Historical missing deliveries remain missing.
One minor review follow-up remains: a concurrent command queued during recovery resync can
wait for the next normal outbox flush; it remains durable and is reported as queued.
