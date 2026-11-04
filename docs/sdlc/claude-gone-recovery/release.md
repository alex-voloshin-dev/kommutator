---
type: release
feature: claude-gone-recovery
status: approved
version: 0.8.1
changelog:
  - "Fixed: recover Claude liveness retirements without crossing conversation lifecycles."
breaking: []
---

# v0.8.1

Failed process probes no longer retire a live registration. Known liveness retirements
can recover through the current trusted hook while explicit ends, superseded conversations
and unknown historical retirements remain fenced. Recovery opens a fresh MCP connection,
retains identity, role and subscriptions, and restores pending wake work. Local lifecycle
epochs prevent old asynchronous deliveries and sweeps from mutating the recovered session.

Claude MCP status now reports caller registration health separately from shared daemon
connectivity. Errors provide actionable recovery guidance; lifecycle and heartbeat logs
include session identifiers and bounded reasons without credentials. Doctor preserves other
diagnostics when a Codex process probe is unverified.

The local daemon database upgrades to schema 3. Keep its pre-upgrade backup: older daemons
cannot reopen it. Hub schema and runtime compatibility contract remain unchanged. Update
both the daemon and client plugin to obtain the caller-aware status and recovery behavior.

An already-gone record from an older daemon has no recorded cause and is not automatically
revived. Run `/exit`, then `claude --resume` in the original project and trust the updated
hooks. Waiting or reloading the plugin alone does not supply a new SessionStart.

## Validation

Final correctness/security review, external review and independent QA approved the change.
Workspace build, typecheck and 448 tests passed before packaging. The full Linux x64
`release:check` then passed: dependency audit, all workspace and release-script tests,
export integrity, clean-environment Claude/Codex startup and exported-client E2E. Source
and exported payload scans found no known local secrets. Negative-control tests
reproduced stale delivery/sweep mutations and stranded wake work before their fixes.
The final packaged-release and installed checks are recorded in the deployment evidence.

## Not validated

The incident's historical retirement trigger could not be proved from the old logs.
Synthetic conformance does not establish live Claude resume behavior, day-long operation,
reboot or external-subnet acceptance. Hooks remain fail-open: no proactive vendor UI alert
is available when a hook does not execute. Inspect caller-aware status and daemon logs.
