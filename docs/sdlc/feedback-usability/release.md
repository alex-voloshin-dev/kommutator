---
type: release
feature: feedback-usability
status: draft
version: 0.14.0
changelog:
  - "Added: hub-resolved @project audience and current/backlog status evidence"
  - "Fixed: reject unknown MCP arguments before SDK preprocessing can discard them"
breaking:
  - "Hub schema 7 fences older readers; fix forward after new project-target admissions"
  - "Previously ignored unknown MCP arguments now reject the entire call"
---

# Kommutator 0.14.0

## Behavior

- `@project` selects other active/idle sessions of the authenticated sender's project with matching membership and hub heartbeat evidence no older than 60 seconds. Selection happens on first hub acceptance, including after offline enqueue; retries preserve the original recipients, including an empty set. This is a recently-seen snapshot, not delivery or wake proof. Durable project-topic subscriptions remain available.
- MCP tools reject unknown arguments with bounded allowed-parameter guidance. Use `status_line` for status updates and `name` for topic joins. Opaque full message IDs remain supported; no prefix lookup or aliases were added.
- `health_details` separates observed connectivity and caller state from unresolved backlog. Aggregate health retains blocked-work degradation. Ages mean time since enqueue, not time blocked; no expiry, deletion, automatic disposition or new recovery side effect is introduced.

## Compatibility and data

Upgrade hub, daemon and client before using `@project`. Unsupported old paths reject it and must not fall back or silently resend. Hub schemas 5/6 migrate transactionally to 7 with preserved history and replay keys. Older hubs cannot read project targets and are fenced from schema 7. Daemon schema 4/runtime contract 3 remain unchanged. Back up with VACUUM INTO; after new operations, fix forward rather than restoring an old snapshot or resetting history. Test-data cleanup retains explicit schema 6/7 support and project-target provenance checks; no production cleanup was performed.

## Qualification

Implementation commit 0a2f84e passed independent correctness/integration, security and QA review. Ordered build/typecheck and 674 workspace tests passed; cleanup tests passed 14. Architecture external review approved. The external code lens was not rerun after the automatic worker's transmission escalation was denied; fresh internal reviews cover this feature, and the missing lens remains explicit.

Exact-version ordered build/typecheck and 674 workspace tests passed. The full release gate passed on its first invocation: 674 workspace and 142 script tests, audit, hosted catalog verification, export integrity, clean-PATH/private setup/cache removal, and synthetic exported lifecycle/message E2E. Source scan was clean; export scan flagged only two runtime hash manifests, whose 191 payload checksums each were verified. Generated catalog hashes match prepared assets. CI, public assets/installations and local rollout remain pending.

## Preserved failures and not validated

An earlier full run failed initial whoami in an existing delayed SessionEnd fixture with Shared daemon unavailable. Its cause remains unknown; a later diagnostic pass is not a fix. Fixture mistakes and their corrections are retained in review-change-2.md. Issues #9, #19, #22 and #25 remain open.

The actual schema-6 reader from baseline 87edea4 was compiled into an isolated temporary probe: it rejected schema 7 and the retirement record remained intact. This exercised no production database. Day-long operability, physical subnet allow/deny, unattended Windows reboot, real Work/native idle wake, real model plugin migration, and other OS/architecture execution remain unvalidated. Linux synthetic process tests cannot close these gates.
