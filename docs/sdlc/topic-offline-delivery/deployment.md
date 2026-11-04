---
type: deploy-status
environment: local-wsl
status: final
pipeline: healthy
deploys:
  - sha: eabd81e0f2f6528031688a1673d6c1c3eac1ea45
    status: passing
    workflow: Release checks
    at: "2026-11-04T01:16:29Z"
alerts: {}
action: Continue monitoring; release qualification and local service checks passed.
---

# 0.9.1 deployment evidence

The final deploy-status assessment is healthy after the main-merge checks completed
(41752824698 release, 41752824662 secrets). Its action is continued monitoring.
No monitoring alert source is configured; this is not a claim of no alerts.
The released commit's branch, PR and tag release checks and secret scans passed before
activation. Tag runs: 41752558250 (release), 41752558280 (secrets).

The published tarball, Claude ZIP and both checksum files were anonymously downloaded
and byte-verified. PR 3 merged as 28e1f4f. The updater applied 0.9.1 from eabd81e after
private backups and image startup checks. Docker reports kommutator-hub:release-0.9.1
healthy; daemon PID 2557044 reports version 0.9.1, contract 3, connected, healthy, no
issues and no queued sends. The retained local client 0.8.1 is compatible; no hook trust
settings were altered. The developer session retained its hub ID, role and both feedback
subscriptions after reconnection. Both feedback services remain active.

The combined workspace passed all 462 tests. Local release qualification reached the final
export E2E and once failed a Codex whoami immediately after synthetic daemon restart; an
isolated rerun against the exact packaged export passed. Both pre-tag CI runs and the tag's
full release gate passed, without weakening tests. Review and QA are recorded separately.

The concurrent maintainer release 0.9.0 was preserved. Intermediate 0.8.2 assets remain
immutable and their notes direct users to 0.9.1; no downgrade was applied. Historical
omissions are not backfilled. Synthetic tests do not close live vendor resume, day-long,
reboot or physical subnet gates.
