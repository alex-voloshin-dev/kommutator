---
type: change-summary
feature: feedback-usability
status: implementation-complete-gate-failed
---

# Implementation handoff

## Summary

Implemented hub-owned `@project` routing with immutable replay audiences, full strict MCP
argument schemas with bounded actionable errors, and additive final-wrapper `health_details`.
Hub schema 7 fences older target readers, supports atomic 5 → 6 → 7 / 6 → 7 upgrades, and
preserves replay history. Canonical contracts were updated before behavior changes.

## Files touched

- `docs/DESIGN.md`, `docs/PROTOCOL.md`: audience, replay, schema compatibility, diagnostics,
  and fix-forward preservation contracts; superseded unsafe reset wording.
- `packages/protocol/src/address.ts`, `schemas.ts`, `test/address.test.ts`: new shorthand,
  shared outbound guidance, complete opaque reply-ID description and syntax regressions.
- `packages/hub/src/routing.ts`, `src/db.ts`, `schema.sql`: authenticated project membership,
  active/idle and inclusive 60-second heartbeat snapshot, target provenance and schema fence.
- `packages/hub/test/messages.test.ts`, `test/invariants.test.ts`: routing boundaries,
  sender/host authorization, mixed/self targets, zero and populated replay, wake rules,
  preserved migration rows/replay and migration rollback.
- `packages/agentd/test/daemon-core.test.ts`: literal offline shorthand, late peer selection,
  and unchanged blocked entry/key after an old-hub rejection. Existing agentd production
  recovery and status side effects are unchanged.
- `packages/cli/src/mcp.ts`, `src/mcp-projections.ts`: full schema registration, strict setup
  registration, bounded argument guidance, project queued-response explanation, and pure
  final status presentation retaining existing aggregate health/recovery.
- `packages/cli/test/mcp.test.ts`, `test/mcp-projections.test.ts`: actual SDK linked transport,
  no resolver/IPC on invalid arguments, setup strictness, huge-key bounds, empty update and
  short opaque reply compatibility, frozen projection input, both status modes, unknown
  evidence, bounded examples, and final-wrapper ownership-change failure.
- `scripts/lib/test-data-cleanup.mjs`, `scripts/test-data-cleanup.test.mjs`: inspection supports
  schema 6/7, preserves old-schema rejection, and refuses retained project-target provenance
  when a selected project topic would be removed. Tests use disposable fixtures only.
- `plugins/claude-code/skills/kommutator/SKILL.md`: client-facing addressing, upgrade and
  status explanation, canonical argument examples and full-ID guidance. Generated hosted
  plugin artifacts are deferred to parent release work.

## Checks and evidence

Runtime observed: Node 26.13.0 and pnpm 12.18.0. Existing frozen-installed worktree dependencies
were used; this engineer did not rerun dependency installation. `af.py stack-detect --repo .`
reported JavaScript from the root manifest; JavaScript and TypeScript packs were read and the
repository's declared build/typecheck/test gates took precedence.

Final ordered gates:

1. `pnpm -r build`: passed, `/tmp/kom-feedback-usability-build-final.log`.
2. `pnpm -r typecheck`: passed, `/tmp/kom-feedback-usability-typecheck-final.log`.
3. `pnpm -r test`: failed, `/tmp/kom-feedback-usability-test-final.log`.
   Protocol 39, hub 192, agentd 169 passed; CLI 269 passed / 1 failed (670 passed,
   1 failed overall). The failing existing process test was
   `claude-resume-process.test.ts > retires only the current SessionEnd authority before a delayed delivery import`.
   At line 359 its initial `whoami` failed with `Shared daemon unavailable; inspect the
   private local configuration and daemon log.`; assertion at line 90 expected error=false,
   received true. This occurred before the test's retirement behavior. No hook timer,
   lifecycle test, recovery policy or process fixture was changed to hide it, and no retry
   was run. The full workspace gate remains failed; cause is not established by this run.

Additional checks:

- Focused agentd core: 108 passed, `/tmp/kom-feedback-usability-agentd-focused.log`.
- Actual MCP transport/projections: 24 passed,
  `/tmp/kom-feedback-usability-mcp-focused-corrected.log`.
- `node --test scripts/test-data-cleanup.test.mjs`: 14 passed,
  `/tmp/kom-feedback-usability-cleanup-final.log`.
- `git diff --check` before parent staging and `git diff --cached --check` after parent
  staging: passed.

Preserved first failures (none are suppressed):

- `/tmp/kom-feedback-usability-test-initial.log`: two new hub migration fixtures omitted
  required `message.from`; hub 190 passed / 2 failed. Fixtures corrected.
- `/tmp/kom-feedback-usability-test.log`: new late-peer agentd fixture used a four-character
  `reg_id`, below the executable schema's eight-character minimum; agentd 168 passed / 1
  failed. Inspected `Methods`, changed to `register-late`, and added local schema parsing.
- `/tmp/kom-feedback-usability-cleanup.log`: one existing assertion expected the old
  `already upgraded` error wording; changed to assert the new schema-6-or-7 requirement.
- `/tmp/kom-feedback-usability-mcp-focused.log`: no projects matched the mistaken
  `@kommutator/cli` filter. This is not test evidence; the corrected command ran from the
  CLI package, whose actual name is `kommutator`.
- The first stack detection attempt used unavailable `python`; rerun with `python3` succeeded.

## Assumptions and remaining gates

`health_details.backlog` ages measure time since enqueue, not first blockage; numeric daemon
`last_error_at` is preserved. Missing outbox evidence produces null counts/ages; empty evidence
produces zero counts and null ages. New diagnostics copy no payloads, credentials, replay keys
or stored error prose. Empty `set_status({})` and opaque 1–64-character reply IDs remain valid.
Only the projection is pure: normal status-triggered retirement reconciliation/flushing remain.

The existing automatic worker patch was inspected read-only for the schema-registration
mechanism. No worker review, approval or test claim was reused; no external-review transmission
was made or retried. All new behavior was implemented and tested in this authorized worktree.

No release/version/catalog update, commit, push, deployment, live service call or production
cleanup was performed. Parent handles independent review, QA and `pnpm release:check` after
release/version preparation; packaging is not claimed here. No automated or short test closes
day-long operability, subnet, reboot, desktop-native/vendor delivery or availability incidents.
