---
type: release
feature: deployment-health-gate
status: qualified
version: 0.16.1
changelog:
  - "Fixed: deployment readiness distinguishes unchanged retained blocked work from new degradation."
  - "Fixed: MCP read and board argument errors identify safe sources for required values."
breaking: []
---

# Kommutator 0.16.1

The local updater can accept verified target services while preserving an unchanged,
preexisting blocked queue and its warning. Exact version, contract 4, process and hub
checks still apply. New or changed blocked work, unknown degradation and malformed
snapshots remain blocking. No queue deletion, replay or automatic retry is added.
The separately installed runner must be refreshed from the reviewed source before
this deployment behavior takes effect; installing a client plugin does not update it.

MCP read and board schemas now explain where to obtain required IDs, topics and keys.
Invalid arguments are rejected before client resolution/IPC. The hints never guess
identity, join topics or grant access. Skill guidance explains host tool discovery
after compaction. Wire schemas, runtime contract 4 and database schemas 5/8 are unchanged.

## Investigation boundaries

The updater failure was reproduced on baseline and the narrow candidate passed its
controlled deployment test. Actual SDK validation reproduced missing guidance.
Same-identity inbox/read controls pass across receipt, rename, topic leave and
reincarnation, but the two reported historical read failures remain unexplained.
Current visible f4ai windows report hook capability; hook-only idle polling is expected,
not native wake. No native-capability failure was reproduced. Historical availability,
registration and hook timing investigations #9/#19/#22/#25 remain open.

## Qualification and rollout

Independent correctness/API, security and external reviews approved the scoped changes.
Independent ordered build/typecheck and 807 workspace tests passed, plus 26 updater
script tests. The first full release:check passed with 807 workspace and154 script
tests, integrity, clean-PATH smoke and synthetic exported E2E. A SessionEnd delayed-import
sample measured201.473 ms, above the200 ms target but below the unchanged300 ms temporary
limit. Artifact secret scan flagged two license-manifest SHA256 values; both were
verified against the path-key license bytes, not credentials. CI, public downloads and
deployment remain pending at this checkpoint.

## Not validated

Historical remote failure reproduction, real-model post-compaction behavior across
all vendors, native Work/idle wake, day-long use, physical subnet allow/deny and
unattended Windows reboot remain unvalidated. No remote daemon deployment is claimed.


## Published qualification and rollout

Release/tag1aa9909, PR35 merge82988e1. Three exact-head full CI runs passed first attempt
(branch 43745460319, PR 43745465205, tag 43745574095), plus three secret scans. Full Git
history scan of 109 commits found no leaks. Both public archives downloaded anonymously and
matched their source-pinned SHA256. Real clean Claude2.1.325 and Codex0.169.0 installations
launched MCP 0.16.1/Node 26.13.0 and verified argument hints, private setup and rejected Origin.
These are installer/MCP probes, not real-model compaction or native-wake acceptance.

After the announced18:20UTC earliest window, the separately installed reviewed runner 0.16.1
performed pinned cutover. Hub started2026-11-15T18:21:23.319Z, daemon observed PID 3572721.
Actual hub, daemon and reloaded chat MCP are0.16.1, contract 4, connected and caller active;
role and both canonical feedback subscriptions retained. No new hook trust was written;
post-update hook execution is not certified by MCP reload alone.

The updater completed normally with idle/appliedVersion0.16.1, without reconciliation.
Its result preserves degraded/retainedBlocked=1 and a warning about the unchanged old
recipient-not-found operation. Current databases and both backups passed quick_check,
schemas 5/8, mode 0600; existing hub indexes remain present. No rollback, deletion or resend.
Timer restored active. Announcement a1cb55cf-dc6b-43c8-a826-6e13afbfcb0d is hub-confirmed,
not proof of recipient read. Remote daemons were not changed.

See [rollout evidence](../../../spikes/evidence/2026-11-15-deployment-health-rollout.json)
and [assessment](deploy-status.md). Historical investigations and extended gates stay open.


## Retained availability observation

The bounded rollout observer recorded 40 HTTP response timeouts (800 ms probe budget):
4 before hub activation and36 after, between18:20:34 and18:23:49UTC. Validated Node
samples show the old hub in D-state/jbd2_log_wait_commit and the new hub in
D-state/folio_wait_bit_common. Host IO-full avg10 peaked 76.51%, memory-full 46.59%.
Twenty-eight failed probes lacked a current Node identity, so no per-process claim is
made for those samples. Responses recovered; later probes and MCP connectivity passed.
This is not a fully stable rollout interval. #22 remains open.

A broad MCP reload preceded the post-update interval; its workload contribution is
unmeasured, not an established cause. No matching kernel allocation/vmbus/OOM/I/O error
lines were returned for18:20–18:24:30UTC. No production stress replay, kernel tuning,
rollback or queue manipulation was performed. Evidence is in
spikes/evidence/2026-11-15-rollout-availability-observation.json. Successful readiness
verification is a point-in-time gate and does not explain subsequent availability.
