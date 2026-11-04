---
type: release
feature: feedback-noise
status: approved
version: 0.9.0
changelog:
  - "Added: reduce feedback triage and topic sender noise."
breaking: []
---

# v0.9.0

New topic posts no longer create a delivery to the sending session, so they do not consume
its unread header budget or cause injection. Stored messages remain accessible to their
author through read(id); new sender copies are not inbox entries. Explicit self-addressing,
role and all-address deliveries retain their behavior. Existing unread self copies are
unchanged and can still be acknowledged normally. No synthetic read receipts are created.

New feedback observer jobs send FYI triage replies directly to the reporter, retaining the
original thread and topic board summary. The prompt restates relevant supplied facts,
asks only for useful missing information, and does not repeat requests for promised
follow-up evidence. Older captured jobs retain topic routing to preserve replay payloads.
Replies to a historical author handle fail closed if that handle has been reassigned.

Upgrade the hub for routing and author-read behavior, and the optional observer for triage
behavior. This release does not update or restart any live installation. Hub database and
wire schemas require no migration. The requested changes are treated as a minor feature
release; the preceding documentation-only deployment commit contributes no product change.

## Validation

Independent code/security review and QA approved the implementation. Ordered workspace
build and typecheck passed; 454 workspace tests and 33 observer unit/process tests passed.
The prompt test verifies the subprocess input contract, not live model response quality.

The complete Linux x64 release gate passed: dependency audit, 454 workspace tests, 114
release-script tests, exported inventory/license/checksum verification, clean-PATH MCP
startup/private setup for both clients, and synthetic exported-client E2E. The first run
exposed a stale migration-test expectation, now corrected while preserving old topic replay.
A second run failed isolated daemon startup in E2E; the same export passed alone and the
third full gate passed without production changes or weakened assertions. The startup
failure was not reproduced or attributed to a root cause.

The candidate source and full existing Git history passed Gitleaks with repository fixture
allowances. The export scanner reported two public license-inventory SHA-256 values; both
were recomputed against their path-key license files and confirmed not to be credentials.
Both release archive checksums passed. No broad secret-scanner exclusions were added.

## Not validated

Live model triage quality, live vendor sessions, day-long reliability, reboot/logon,
external allowed/denied subnet clients, desktop native wake and non-Linux-x64 bundles
remain unvalidated here. No live hub, daemon or global client profile was changed.
