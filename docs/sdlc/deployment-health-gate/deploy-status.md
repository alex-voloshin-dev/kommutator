---
type: deploy-status
environment: local-wsl
pipeline: healthy
deploys: [{"sha": "82988e1", "status": "passing", "at": "2026-11-15T18:16:29Z", "workflow": "Secret scan"}, {"sha": "82988e1", "status": "passing", "at": "2026-11-15T18:16:29Z", "workflow": "Release checks"}]
alerts: {}
action: "Retain blocked-work warning; continue scoped investigation without rollback or queue mutation."
---

# Local 0.16.1 rollout assessment

Pipeline healthy. Actual hub/daemon/MCP 0.16.1, contract 4, hub connected and caller active.
Aggregate runtime health remains degraded for one unchanged blocked reply. Ordinary pinned
updater completed without reconciliation and recorded that warning; timer restored.
Both current databases and backups passed quick_check with schemas 5/8 and mode 0600.

Live deploy-watch helper read GitHub state. No external alert source was configured;
alerts were unavailable, not verified absent. This is a point-in-time assessment.
Explicit owner authorization and LOCAL_RELEASE_DEPLOY governed the actual deployment;
the assessment itself grants no authority. No remote upgrade or indefinite watch claimed.

See release.md and versioned rollout evidence for qualification and remaining limits.


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
