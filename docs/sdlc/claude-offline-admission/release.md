---
type: release
feature: claude-offline-admission
status: candidate
version: 0.16.2
changelog:
  - "Fixed: registered Claude tracked sends and explicit acknowledgements use local owner preflight before durable offline admission."
breaking: []
---

# Kommutator 0.16.2 — Claude offline admission

## Fixed

An already registered Claude owner preflights tracked send/ack through local
operation.status instead of whoami, whose remote topic lookup could stop the call
before durable offline admission. The same UUID, existing owner/process/generation
checks, atomic observation/outbox transaction and single submit are preserved.
No retry, queue deletion, receipt relaxation, schema or runtime contract change.

## Evidence and qualification

The original implementation failed both controlled offline send/ack regressions.
The candidate passes them and later settles each original operation once. Independent
correctness/security and external reviews approve; independent QA added real-core
retired/superseded-owner negatives. Focused tests 40/40, build and typecheck passed.

Two ordinary local full gates stopped in unchanged hub database tests (each hub 206
passed/3 failed; protocol 41 passed). The first had migration setup/rollback and WAL
backup timeouts; the second substituted a durable-message reopen scenario for setup.
Later isolated checks of the first three cases passed, not explaining the failures.
A diagnostic run then measured three synchronous SQLite exec calls at 42.7–46 seconds.
It is not qualification and does not establish the storage/device/workload cause.
No timeout or durability setting was weakened. See the November 20 incident and evidence.

Full hosted CI, packaging, anonymous assets, native installer probes and local rollout
are pending. Publishing requires the unchanged complete release gate to pass on the
exact candidate. Local failures remain visible even after green hosted checks.

## Boundaries and not validated

The repair removes an extra remote lookup for a registered valid owner. Fresh
ipc.hello may still wait on its existing flush. Missing/retired registration recovery
still uses the committed hook and may require hub connectivity. Direct operation
lookup remains recovery-free. No historical unknown send is declared lost, uncommitted
or safe to resend; the reports even disagree on the second UUID.

This does not fix the underlying hub availability issue #22, historical read failures,
all lifecycle/IPC incidents, or native idle wake. Real-model post-compaction behavior,
day-long use, physical subnet allow/deny, unattended Windows reboot and non-Linux-x64
bundles remain unvalidated. No remote daemon update is claimed.

## Publication window

The maintainer deferred publication and local cutover until after 2026-11-22
10:30 UTC based on reported fleet production windows. This is an earliest window,
not a scheduled unattended release. Reannounce actual maintenance before publication.
The existing updater timer remains active on published0.16.1; do not publish assets
or merge their catalogs before qualification and the coordinated window.
Notice:6b6ec887-0334-4661-9181-b4986ed6b6c2.
