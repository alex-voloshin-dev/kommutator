---
type: release
feature: mutation-reconciliation
status: approved
review_decision: proceed
version: 0.13.0
changelog:
  - "Added: durable owner-scoped operation_status for uncertain MCP send and acknowledgement outcomes."
  - "Changed: send and ack return a correlation UUID, including uncertain failures, without automatically resubmitting."
  - "Changed: bounded local observation storage migrates agentd state to schema 4; hub schema and runtime contract remain unchanged."
breaking: []
---

# Kommutator 0.13.0 development preview

When MCP send or ack times out, keep its `operation_id` and call `operation_status`
from the same session owner. The daemon retains a bounded durable observation with
`unknown`, `queued`, `confirmed` or `blocked` state. A lookup never resubmits a mutation.
Confirmed sends mean hub storage/routing, not recipient read. Ack counts describe the
last confirmed hub attempt; counts from a lost original response remain unknown.

Already bound lookups use a dedicated bounded IPC lane and a pure local compatibility
probe. They neither wait behind the timed-out mutation nor trigger retirement or queue
flush. A new connection still performs ordinary hello, which can wait for registration
and flush; this is not a hard availability guarantee. Lookup does not start a daemon.

Observations survive same-owner daemon restart. A replacement process, generation,
lifecycle epoch or logical session cannot read a previous owner's result. Retention is
24 hours and 256 confirmations per owner, with at most 4096 observations globally.
Unresolved rows remain retained; capacity exhaustion rejects admission before enqueue.
Stored results are capped at 65536 UTF-8 bytes; larger delivery maps are explicitly omitted.

## Upgrade and recovery limits

Agentd state migrates to schema 4. Older daemons cannot reopen that database. Preserve
the current state and prefer a compatible fix forward. A pre-upgrade backup alone is
not safe restoration after new work was admitted; no automatic downgrade is supported.
Old clients retain their legacy methods. New clients require the new daemon methods and
report upgrade guidance without falling back to an untracked submission. Hub methods,
replay keys and runtime compatibility contract 3 are unchanged.

The loaded MCP must be updated/restarted to expose the new tool. An outer MCP reply lost
before the caller learns the UUID cannot be reconciled through this API. Expired or
foreign observations are unknown, never proof of non-admission or permission to resend.

This release addresses uncertain outcomes, not the underlying hub availability incident
#22. Issues #9 and #19 remain open for their unproven historical triggers. Hook deadlines
remain 140/90 ms; full-process tests retain the temporary strict 300 ms limit, target 200 ms.

## Qualification

Independent correctness/security and external review approved the implementation.
Independent QA passed ordered build/typecheck and 647 workspace tests. The final 0.13.0
release gate passed ordered build/typecheck, 647 workspace and 140 script tests, dependency
audit, export integrity, both clean-PATH smokes and synthetic exported E2E. Generated
catalog hashes match the published archives. Branch/PR/tag CI and anonymous downloads
passed. Real clean-profile Claude Code 2.1.323 and Codex CLI 0.167.2 installs launched MCP
0.13.0 with bundled Node 26.13.0, the new tool and private setup/origin protection.
The ordinary updater deployed hub and daemon 0.13.0; both database backups passed
quick_check with mode 0600, live daemon schema 4 passed quick_check, health is green,
caller active, hub connected and outbox empty. Checkpoint is idle/applied 0.13.0 and
timer restored. The live chat MCP remains compatible 0.12.6; no hot client update is claimed.
The first release gate passed 647 workspace and 140 script tests, integrity and clean-PATH
smokes, then timed out on owner-2 set_status in exported E2E. Both hook registrations were
intact. A bounded diagnostic replay passed 61 calls but did not establish the cause;
[#25](https://github.com/alex-voloshin-dev/kommutator/issues/25) retains this investigation.
See [review](review-change-3.md) for preserved intermediate failures and review corrections.

## Not validated

Day-long reliability, unattended Windows reboot, independent allowed/denied LAN clients,
native Work/idle wake, other target platforms and real model conversations after plugin
migration remain open. Synthetic production-path MCP tests do not establish those gates.
