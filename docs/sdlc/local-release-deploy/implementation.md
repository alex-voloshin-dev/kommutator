# Local release deployment implementation

2026-11-02. Optional operator infrastructure; no hub protocol or database schema change.

The private opt-in updater polls only the fixed repository, including published GitHub
previews with numeric semver tags. Complete Linux x64 release assets and latest successful
exact-commit Release checks/Secret scan runs gate preparation. A fresh tag-pinned clone
installs frozen dependencies and builds the CLI; its actual built RELEASE_VERSION must match.
The existing and rendered Compose boundaries reject changed ports, mounts, user and isolation.
A version-tagged image is built before downtime; online hub and daemon SQLite backups precede
activation. Actual running versions also fence downgrade when the baseline was misconfigured.
Successful activation requires healthy hub, exact daemon version, a positive runtime contract
and connected daemon. Source runtime contract is not guessed from a nonexistent export.

The checkpoint uses atomic replacement with file and directory sync before mutation. Failure
or interruption blocks automated re-entry pending explicit reconciliation. The wrapper forwards
termination to the locked worker, whose AbortController stops its active process group. A
successful detached agentd intentionally survives command/service completion (KillMode=process).
A failed update does not automatically restore an older binary against a possibly newer schema.

An adjacent observer correction clears only the historical capture-specific transport error
once capture succeeds. It preserves analysis/report errors. Its regression proves failure,
recovery and retention of an unrelated analysis error.

Observed implementation checks: pnpm install --frozen-lockfile, pnpm -r build, pnpm -r typecheck,
and pnpm -r test passed in order: 393 workspace tests (33 protocol, 141 hub, 73 agentd, 146 CLI).
The initial nine updater tests passed, covering version/asset/CI gates, private opt-in, dedupe,
crash fencing, Compose isolation, ordered staged activation with a real SQLite backup,
command cancellation and successful detached-child survival. All 19 observer tests passed.
An actual built protocol export probe returned version 0.4.0. Independent QA adds final
process/regression coverage and records its own executed checks separately.

No live Docker/daemon change, service installation, commit or publication was performed by the
implementation agent. The coordinator owns actual deployment evidence. Reboot, physical LAN
subnet, day-long use and vendor registration/wake remain separate acceptance gates.
