# Claude registration recovery

## Scope and assumptions

The direct user report is the implementation request: stop false process retirement,
recover a known liveness retirement without confusing conversations, and expose caller
registration failures separately from shared daemon health. Preserve explicit SessionEnd,
supersession, PID-reuse, project and generation fences. Hooks retain their fail-open stdout
and deadline contracts; this change does not add a proactive vendor UI notification.

## Observed incident

Read-only inspection on 2026-11-03 confirmed a live Claude process whose birth matched
the local gone record. Its latest private hook registration was generation 1 and had no
ended tombstone. The installed plugin was 0.7.0 and daemon 0.8.0, runtime contract 3.
The report was relayed to the feedback topic with user authorization. Private evidence
and a database backup were retained outside the repository; tokens were not published.

The historical retirement cause cannot be proved from the old logs. A concrete code
defect was found: an unavailable process-birth probe, including a `ps` timeout, was
treated as proof that the process exited. Socket availability was not the liveness test.
Old gone records have no retirement reason, so their cause is not retroactively inferred.
They require a genuine new SessionStart via `/exit` and `claude --resume`.

## Implementation

- Unknown process probes preserve registration; only definitive absence or changed birth
  retires a process. Uncertainty still cannot authorize a new ownership binding.
- Local state schema 3 persists retirement reason and a lifecycle epoch, migrating schemas
  1/2. Older daemons cannot reopen schema 3; retain a pre-upgrade backup for rollback.
- Same-generation hook recovery is limited to known liveness retirement. Explicit ends,
  superseded conversations and unknown legacy retirements stay fenced. A recovered MCP
  client opens a fresh shim; already dispatched mutations are never automatically retried.
- Lifecycle epochs fence deferred sweeps and native-delivery completions. Recovery restores
  retained wake work without parallel sends or receipts from stale completions.
- Claude MCP status reads the exact hook owner without registration or daemon startup.
  Caller unavailability degrades its result even if the shared hub connection is healthy.
  Doctor accepts unverified Codex liveness without discarding other diagnostics.
- Structured lifecycle/heartbeat logs contain session identifiers and bounded reasons or
  error codes, excluding credentials, socket paths and arbitrary transport error text.

DESIGN and PROTOCOL contain the resulting contracts. No dependency, hub schema, wire
version or daemon runtime compatibility contract change is required.

## Verification boundaries

Independent implementation, correctness/security review, external review and QA ran in an
isolated worktree. QA added a composed MCP-client/daemon/hub test preserving session ID,
role, topic memberships and unread work while sending a mutation once. Separate tests
cover uncertain probes, explicit ends, legacy retirement, status races and migration.

External review found stale asynchronous completions and stranded wake work; both were
addressed with regressions. Temporarily removing the lifecycle comparisons made the stale
delivery and sweep regressions fail, proving that they exercise the protection. Both
written and accepted native outcomes are covered; stale accepted work must not mark read.

Automated conformance is not a live Claude resume observation. The historical trigger,
day-long operation, reboot and external-subnet acceptance remain separate evidence gates.
See the final review and release artifacts for the completed check results.
