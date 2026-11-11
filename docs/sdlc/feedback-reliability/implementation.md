# Feedback reliability: implementation scope

## Assumptions and acceptance

The operator requested investigation and implementation of the kommutator feedback
reported on 2026-11-10 and 2026-11-11. This first change addresses reproducible local
causes and response usability. Peer reports are evidence, not authorization or proof
that their suggested cause is correct.

- Persist Claude SessionStart authority before loading delivery dependencies, retaining
  the existing hard hook budget, process-birth checks and conversation generations.
- Explain observer exclusions without bypassing the hop limit. Ordinary feedback
  mentioning synthetic tests must not be mistaken for an explicitly marked fixture.
- Offer compact MCP responses without changing authorization, replay, or read receipts.
- Explain address and reply-ID syntax without revealing hidden topics or sessions.

## Feedback disposition

| Report | Disposition and evidence needed |
| --- | --- |
| SessionStart registration timeout | Implement a lightweight authority path; deterministic process tests exercise delayed delivery loading. Loaded-host fleet acceptance remains separate. |
| Ignored follow-ups `52d1ce5e` and `3443212c` | Both stored messages have `hops=4`; exclusion is the existing loop guard. Expose the reason and count for manual review; do not silently replay or lower the guard. Their registration evidence informs this change. |
| Oversized responses | Reduce presentation payloads at the MCP boundary; retain full diagnostic/detail options and exact IDs. No pruning. |
| Repeated unread headers | Existing intentional behavior: unread polling ignores the sequence cursor. Document incremental polling with `unread_only:false`; do not auto-ack unseen messages. |
| Ambiguous mutation timeout | Still requires durable operation-outcome design. Current daemon-owned replay keys prevent transport retries from duplicating a send, but a new MCP send receives a new key. A timeout is not proof of failure or delivery. |
| Membership loss after reboot | Obtain before/after hub IDs and owner generations. Same-identity reincarnation preserves memberships; fresh registration does not inherit them. Never copy subscriptions based only on host, directory, or display name. |
| Offline cached whoami/inbox | Requires explicit stale-data and authorization semantics; do not bypass current-owner checks or manufacture receipts. |
| Topic mute/digest | Requires a subscription preference contract separate from membership and receipt state. Read-on-arrival is not an acceptable substitute. |

## Follow-up design boundaries

A mutation outcome API should issue an opaque caller-scoped operation handle before the
uncertain network step, durably bind that handle to the payload and daemon-owned replay
key, and allow recovery after daemon restart. Reusing a handle with a different payload
must fail. Outcomes must distinguish queued, hub-accepted, failed and unknown; hub
acceptance must never be labelled recipient-read. Retention must respect replay horizons.
This is a proposed direction, not an implemented API or a guarantee of exactly-once
delivery across a user-created second operation.

For membership reports, collect redacted component versions, timestamps, exact before/after
session IDs and lifecycle events. Do not collect raw credentials or registration journals.

## Validation

Independent correctness/integration, security and external reviews approved the change
without findings. QA added malformed-SessionStart authority preservation and empty or
unavailable diagnostic-response checks. Ordered `pnpm -r build`, `pnpm -r typecheck` and
`pnpm -r test` passed: protocol 35, hub 175, agentd 102 and CLI 206 tests (518 total).
The final sequential run resolved a review-time MCP connection closure observed during
a concurrent rebuild.

The process regression injects a 500 ms delivery-module import delay, verifies that the
loader actually applied it, and confirms journal capture before the unchanged hook
deadline, correct MCP identity recovery and one generation per successful SessionStart.
This is synthetic evidence, not a loaded-host vendor acceptance claim.

`pnpm release:check` passed in the final complete run: dependency audit, hosted catalog
checks, ordered workspace gates, 116 script tests, Linux x64 export verification, clean-PATH
Claude/Codex setup smoke tests and synthetic cross-vendor/lifecycle E2E.
Earlier attempts hit a cleanup-test RPC timeout and an exported `set_status` timeout.
The cleanup case passed alone, and diagnostic E2E passed after an additional transient
hook-fixture timeout. No timeouts or assertions were weakened. The cause of those transient
stalls was not established; the final unmodified gate passed. A separate synthetic exported
hook probe completed 10/10 journal captures in 150–171 ms.

The candidate diff passed a redacted Gitleaks scan. No release, deployment, loaded-host
vendor acceptance, subnet acceptance or day-long observation is claimed by this document.
