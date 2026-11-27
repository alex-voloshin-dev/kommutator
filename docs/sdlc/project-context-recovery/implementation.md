---
type: implementation
feature: project-context-recovery
status: ready-for-review
date: 2026-11-27
---

# Implementation handoff

Implemented the reviewed project-context contract in the isolated
`fix/project-context-recovery` worktree. DESIGN §19 and PROTOCOL were amended before
behavior changes; the subsequent reviewed first-registration explicit-assertion clarification
was applied before that behavior. No wire/database schema or release version changed.

## Behavior and files

- `agentd/core.ts`: exact established Claude owner context is selected before inferred
  discovery. Caller and daemon explicit assertions are checked independently on first
  registration and refresh, before retirement/lifecycle publication. Existing birth,
  generation, retirement, ambiguity, operation-transfer and peer fences remain.
  New mapped owners require fresh matching Git evidence. Existing Codex roots stay pinned.
- `agentd/project-contexts.ts`, `paths.ts`, `daemon.ts`, `index.ts`, `project.ts`: strict
  version-1 private file (128 entries, 64 KiB), IPC project-key validator reuse, descriptor
  no-follow/type/owner/mode/size validation, startup loading, fresh uncached observations,
  exact-record revisions, exclusive private writer lock, exclusive private temporary file,
  atomic rename and directory fsync. Cleanup checks lock inode/device before unlinking it;
  preexisting or replaced locks are retained. Missing files mean no selection.
- `cli/project-context.ts`, `commands.ts`: preview/select/remove, explicit apply/revision,
  sanitized fresh origin validation, exact lexical absolute cwd, deleted-checkout removal,
  no IPC/hub contact or service restart. Activation wording distinguishes Claude new owner/
  conversation from a new independent Codex root.
- `docs/DESIGN.md`, `PROTOCOL.md`, `OPERATIONS.md`: contract and concrete operator recipe,
  intentional explicit-context compatibility tightening, startup/activation and history limits.
- Behavioral tests in agentd `daemon-core.test.ts`, `project.test.ts`,
  `project-contexts.test.ts` and CLI `project-context.test.ts`.

The integration fixture uses the real hub conformance dispatcher/database with an isolated
in-process transport. It verifies unchanged legacy board authors/versions/history, normal
mapped registration membership, denied unmapped access/reserved join, stale CAS rejection,
restart-persisted Claude identity, Codex replacement versus independent roots, changed/missing
origin failure, exact symlink-alias mismatch, and A → B → A context/generation controls.
It is not a live vendor or real socket deployment claim.

## Validation and retained failures

Toolchain observed: Node v26.13.0 and pnpm 12.18.0. Existing frozen installation supplied
by the parent was used. Stack detection returned JavaScript; engineering, JavaScript and
TypeScript packs were read. No lint/format script exists.

1. First focused baseline invocation could not resolve `@kommutator/protocol` because this
   new worktree had no `dist`; it ran zero tests. Built the unchanged baseline successfully
   (`/tmp/kom-project-baseline-build.log`).
2. Repaired deterministic expectation against unchanged baseline core failed exactly with
   `Conflicting project context` after initial missing origin followed by successful Git
   discovery: 1 failed, 126 deselected (`/tmp/kom-project-baseline-test.log`). The historical
   test had expected this rejection; its replacement now requires refresh and fresh-shim
   success with the same UUID/project while a genuinely new owner sees recovered discovery.
3. First implementation build passed (`/tmp/kom-project-build.log`), but typecheck failed
   on a helper's inferred `number | bigint` stat mode (`/tmp/kom-project-typecheck.log`).
   Replaced the overloaded return-type extraction with the concrete standard `Stats` type.
4. Build2/typecheck2 passed. Initial focused run had 146 passes and three existing shutdown
   regressions (`/tmp/kom-nov27-project-focused-agentd1.log`). The new registry read followed
   an awaited birth probe without its original open guard. Restored `requireOpen()` before
   any registry access; these controls now pass. No tests were weakened.
5. Ordered implementation build3 then workspace typecheck3 passed:
   `/tmp/kom-nov27-project-build3.log`, `/tmp/kom-nov27-project-typecheck3.log`.
6. Focused agentd rerun: **152 tests passed** in three files, including all 129 daemon-core
   tests (`/tmp/kom-nov27-project-focused-agentd2.log`). CLI first filter used the wrong
   workspace name and matched no projects (`/tmp/kom-nov27-project-focused-cli1.log`);
   corrected `--filter kommutator` run: **2 tests passed**
   (`/tmp/kom-nov27-project-focused-cli2.log`).
7. `git diff --check` passed. The parent owns permanent evidence copying and final exact-head
   qualification. Full workspace `pnpm -r test` and `pnpm release:check` have **not** been run
   by this implementation agent; they remain required after independent review/QA.

Private-file controls cover malformed/version/unknown-field/duplicate/bound failures,
unsafe file modes, symlinks, nonregular files, temporary collision, retained/replaced locks,
concurrent writer rejection, verification failure cleanup, same-project changed-remote CAS,
other-entry preservation, missing-file startup and invalid-file startup failure. Descriptor
owner checking is implemented; a separate real foreign-owner/race-injection test is not claimed.

## Remaining gates and boundaries

Independent implementation/security review, QA and full workspace/release qualification
remain. No installed runtime, live configuration, memberships or board histories were changed.
No history merge, automatic legacy-key inference, MCP selector, pruning or receipt behavior
was introduced. Existing Codex diagnostic wording from the prior commit was preserved.
Day-long use, physical subnet, reboot and actual vendor activation gates remain open.

## Independent review correction: predecessor-probe concurrency

The external code review found that deferred supersession used owner snapshots captured
before an awaited predecessor birth probe. Concurrent registration/receipt/DND writes could
be overwritten by `markGone`, including loss of the just-assigned hub UUID. The correction
reloads current owned records and revalidates generation admission after the final await.
Any reused predecessor is reloaded and its process/context/generation/lifecycle fence is
checked before mutation. Supersession then operates on current records without another await.

Added a deterministic paused-probe regression using actual isolated hub reconnect,
registration, CLI DND, send and explicit read receipt. Against the previous core it loses
the UUID and reverts wake to `on` (`/tmp/kom-nov27-project-review-regression-baseline2.log`).
The first fixture attempt expected delivery alone to advance the read cursor and failed
before reaching the defect; it was corrected to use an explicit read receipt, preserving
receipt semantics (`/tmp/kom-nov27-project-review-regression-baseline.log`). A second control
retires the candidate during its probe and verifies rejection without superseding the active
conversation. Context rejection still precedes all new lifecycle publication.

The first correction build passed; typecheck caught a test-only missing `status === "sent"`
narrowing before accessing a send ID. That failure is retained in
`/tmp/kom-nov27-project-review-typecheck.log`; the initial focused run passed 136 tests.
After adding the explicit discriminant check, ordered workspace build and typecheck passed
(`/tmp/kom-nov27-project-review-build2.log`, `/tmp/kom-nov27-project-review-typecheck2.log`).
The final focused run passed **136 tests** (131 daemon-core, 5 operation-boundary),
recorded in `/tmp/kom-nov27-project-review-focused2.log`.
Independent re-review and complete exact-head qualification remain with the parent.
