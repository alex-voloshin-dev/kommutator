---
type: release
feature: feedback-operation-recovery
status: prepared
review_decision: proceed
version: 0.15.1
changelog:
  - "Fixed: retain operation observations across consecutive uninterrupted Claude refreshes"
  - "Fixed: return each tracked operation after its own durable settlement"
  - "Fixed: direct runtime compatibility recovery to the outdated component"
breaking: []
---

# Kommutator 0.15.1

## Fixed

- A consecutive SessionStart refresh of the same uninterrupted Claude conversation
  retains access to its operation observations. This covers the controlled compaction
  shape, including queued operations and delayed initial registration. Old IPC peers
  remain fenced; ended/replaced owners, skipped generations and A → B → A do not inherit.
- Tracked send/ack returns after its own durable settlement instead of waiting for
  unrelated outbox work. Shared flushing and replay continue unchanged. Disconnect and
  shutdown cancel waiting callers without deleting admitted work.
- Setup and tool compatibility diagnostics identify which runtime contract is older.
  An old client is instructed to update itself, not restart or downgrade a newer shared
  daemon. Missing/malformed metadata produces bounded inspection guidance.

## Compatibility and recovery

No schema, runtime-contract or hub-protocol change: local schema 5, runtime contract 4,
hub schema 7. Existing 0.15.0 clients are compatible; update the client to obtain new
diagnostic wording. Update the daemon for observation transfer and early settlement.
Only future validated refreshes transfer observations: this release does not adopt
already-inaccessible historical rows. Unknown never proves failure and does not permit
blind resend. Hub confirmation means storage/routing, not recipient read.

## Qualification

Implementation c4c117c passed independent correctness/integration, security and external
review, plus independent QA: ordered build/typecheck and 724 workspace tests. Controlled
baseline failures and initial gate corrections are retained in implementation.md and
review-change-3.md. Exact-version ordered build/typecheck and 724 tests passed. Full release:check passed
on its first invocation: 724 workspace tests, 142 script tests, dependency audit,
export integrity, clean-PATH probes and synthetic exported lifecycle/messaging E2E.
Source/history scans were clean. Two export scanner findings were checksum manifests;
all 191 payload hashes per vendor were independently verified. Public installation
and production rollout remain pending, not implied by these checks.

## Not validated and remaining work

Real model-driven Claude compaction, other-platform artifacts, day-long operability,
physical subnet allow/deny, unattended Windows reboot and native Work wake remain open.
Historical hub outages (#22), every reported timeout and safe terminal outbox disposition
are not resolved by these controlled fixes. No production queue deletion, kernel tuning,
blind replay, receipt change or hook timeout increase is included.
