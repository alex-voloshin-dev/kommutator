---
type: research-brief
feature: project-context-recovery
status: draft
review_decision: proceed
date: 2026-11-27
sources:
  - "packages/agentd/src/project.ts"
  - "packages/agentd/src/core.ts"
  - "packages/agentd/src/registry.ts"
  - "packages/agentd/test/daemon-core.test.ts"
  - "docs/DESIGN.md"
  - "docs/PROTOCOL.md"
  - "packages/hub/src/topics.ts"
  - "packages/hub/src/sessions.ts"
  - "spikes/evidence/2026-11-27-completed-availability.json"
  - "docs/sdlc/project-context-recovery/feedback-triage.md"
  - "packages/agentd/src/binding.ts"
  - "spikes/RESULTS.md"
---

# Project identity drift and recovery research

## Scope and observations

The [durable feedback record](feedback-triage.md) maps full message UUIDs,
timestamps and reported versions. Feedback 509, 511, 514 and 515 reports two project keys in one checkout,
Claude project-context rejection, and failed access to the old project board.
The affected author reports client 0.16.1/daemon 0.17.2 before exit/resume,
then client 0.17.2 and a new UUID/handle after resume. These are remote reports,
not independent process captures. Sender-side recipient-not-found does not
establish the failed recipient's cause or prove a prior message did not commit.

## Independently investigated tracks

### Derivation and lifecycle

`project.ts` normalizes Git origin identically in 0.16.1 and 0.17.2. Commit
ece4c440525e313d7ec3aaa020f729c64f3611b4 changes negative cache retention:
failed/missing results now expire. The bounded Git lookup collapses all execution
errors to absence; the source alone cannot establish timeout as incident cause.
`core.ts` registerOwner recomputes project before Claude same-owner validation and
rejects a changed inferred key. The existing daemon-core regression deliberately
expects this rejection. A miss then success can therefore produce the reported
shape without an upgrade. Claude new-process reuse additionally requires equal project,
so a changed key can produce a new UUID by design. Actual remote attribution
requires original lookup/owner evidence.

### Authorization and recovery

DESIGN section19 fixes priority as normalized remote, caller KOM_PROJECT, basename.
KOM_PROJECT is not an override of a successful remote. Reserved project membership
is derived from registration; topics.ts rejects manual joins. Session updates do
not migrate project membership. No general supported project alias/migration
exists. Local board management can read through an exact existing live local
session and normal hub membership checks; it does not grant a new seat access.
Same basename or cwd is insufficient evidence to join two project namespaces.

### Availability evidence

The completed-observation evidence is recorded in
[the versioned summary](../../../spikes/evidence/2026-11-27-completed-availability.json),
including the raw snapshot SHA-256, size, boundaries and all failed samples.
The bounded collector completed 8640 HTTP probes, 8636 expected401 and four
800ms-budget timeouts. Three preceded rollout; the fourth at Nov25 23:20:13UTC
matched the post-user-restart0.17.2 hub in D-state/journal wait before and after.
These are unauthenticated response probes, not delivery qualification. No shared
cause of every historical IPC/registration/storage failure is established.
Storage work needs continued bounded evidence, not weaker durability or retries
of unknown operations. Existing evidence and collector are independent of this
project-context repair.

### Codex diagnostic gap

`core.ts` ipc.hello sends Codex hooks through bind rather than register.
`binding.ts:7-11` excludes gone records and gives the generic waiting-for-hook
error when an exact vendor ID lacks a unique live match. Codex hooks cannot
create/revive roots (DESIGN section19); the registering call must come from a
root-metadata-bound shim. `core.ts` caller status already supplies correct
Codex reconnect/whoami guidance; the gap is the separate binding error path,
not a missing recovery policy. Preserve ambiguous-case refusal and -32020.

## Recommendations and boundaries

1. Design stable project context for an exact established owner: preserve its
registered project for that owner lifetime regardless of why inferred discovery
changed (transient recovery OR intentional Git initialization/remote change),
while checking unchanged cwd,
process birth, generation/lifecycle and explicit conflicting context. Never infer
that a short key was accidental; old records have no discovery provenance (LocalRecordSchema in registry.ts,
unchanged across v0.16.1..v0.17.2). This explicitly replaces DESIGN19
rejection after inferred project change; it cannot selectively distinguish
recovery. Intentional repository changes require a new owner/context rather
than silently moving the live owner. The former regression expecting rejection
must become a pinning regression with unchanged authorization negative controls.
Codex already retains its existing registration context; its reported namespace
split is the independent new-session discovery/access problem.
2. Provide an explicit operator-controlled checkout project selection/recovery
path for old-board access. It must not silently merge boards, rewrite authorship,
move unknown operations, or relax reserved-topic membership. Decide its precise
contract before code; existing settings are insufficient.
3. Preserve retrying discovery for genuinely new owners; evaluate distinguishing
transient Git failure from confirmed missing remote without extending hook timers.
4. Correct Codex's misleading generic waiting-for-hook guidance separately.
5. Keep availability and historical issues open. Qualify source-reproduced fixes;
never claim this project repair solves the storage stall.

No PRD exists; the user request recorded in [feedback triage](feedback-triage.md) supplies goals: restore reliable registration,
provide safe old-board recovery, investigate remaining availability failures,
and prepare a qualified release. Implementation needs an independently reviewed
technical design, regression baseline, owner/authorization negative controls,
ordered build/typecheck/test and release qualification.
