---
type: release
feature: reconnect-authority
status: published
review_decision: proceed
version: 0.15.0
changelog:
  - "Fixed: stable process identity and durable early Claude registration"
  - "Fixed: full lazy-start budget and shutdown-close confirmation"
  - "Security: suppress native delivery until current process ownership is verified"
breaking:
  - "Local runtime contract 4 requires updated Claude MCP and lifecycle hooks with a new owner process"
  - "Local state schema 5 rejects older daemons; preserve history and fix forward"
---

# Kommutator 0.15.0

## Fixed

- Linux process identity uses boot ID and exact start ticks, independent of timezone
  or locale. Legacy text is unverified rather than proof of process replacement.
- Claude SessionStart commits its bounded owner-generation journal synchronously
  before asynchronous delivery. Interrupted delivery can replay that exact authority;
  MCP never invents a registration from launch environment or working directory.
- Lazy daemon startup uses its declared connection/hello budget. A daemon appearing
  after 2.2 seconds within a 5-second budget no longer requires a second call.
- Normal IPC closure during shutdown is uncertainty, followed by a fresh absence
  probe. Shutdown is sent once; application mutations are never replayed blindly.

## Security

Native delivery verifies current process birth and generation after asynchronous
work, before delivery bookkeeping or endpoint use. Unknown legacy owners retain
their pending unread work and cannot receive native message bodies.

## Compatibility and upgrade

Runtime contract 4 and local schema 5 are intentional compatibility changes; hub
schema 7 and hub protocol remain unchanged. Preserve backups, history, replay keys
and queued work. Do not downgrade the daemon or restore an old snapshot after new
operations; fix forward. Old readers reject schema 5.

For each affected Claude owner, update MCP and all lifecycle-hook wiring, exit the
old process and launch a new process with trusted updated hooks. Reloading plugins
inside the same legacy process is insufficient. A unique predecessor's identity,
role, subscriptions and history can be retained only with positive owner-exit
evidence; ambiguous owners do not inherit each other's state. Unrelated old clients
may remain temporarily unavailable; host-wide process termination is not required.
See [the transition runbook](../../LOCAL_RELEASE_DEPLOY.md#runtime-contract-4-and-local-state-schema-5-transition).
Service health alone is not client readiness.

## Qualification

Implementation 91ac575 passed independent correctness, security, integration and
external review, followed by independent QA: ordered build/typecheck and 697 tests.
Candidate hook controls committed exact authority in 136/134/144 ms; verified
retained 0.14.0 failed the delayed-ps and delayed-link negative controls. The actual
old Registry rejected schema 5 and preserved queued work. Exact-version build/typecheck and 697 tests passed. The full release gate passed
on its first invocation: 697 workspace tests, 142 script tests, dependency audit,
export integrity, clean-PATH/private setup probes and synthetic exported lifecycle/
messaging E2E. Source/history scans were clean; two export findings were hash
manifests, and all 191 payload hashes per vendor were verified. All six branch/PR/tag
CI checks passed. Public archives and hashes were verified anonymously before
catalog merge. Actual clean-profile Claude 2.1.323 and Codex 0.167.2 installations
launched MCP 0.15.0 and passed private setup/origin checks. These are synthetic
installed-runtime probes, not real model conversations.

PR #29 merged as bb600bfa; release commit is 4c445060. The pinned updater cutover
deployed hub and daemon 0.15.0, contract 4, without manual recovery. Hub started
16:40:34 UTC and daemon 16:40:42 UTC. Both backups and current databases passed
quick_check with mode 0600; daemon migrated 4 to 5, hub remains 7. Checkpoint is
idle/appliedVersion 0.15.0 and the timer is active. Local Claude/Codex plugins and
the actually reloaded chat MCP are 0.15.0. Current caller is active, both feedback
subscriptions retained, and outbox is empty. All five Kommutator hooks report trusted
without manual trust changes; this listing alone does not prove live execution.
Announcement: 3be81524-7aff-482a-b7c7-5d297ae4ddb2. See
[rollout evidence](../../../spikes/evidence/2026-11-13-reconnect-rollout.json).

## Preserved failures and not validated

Earlier runs observed an IPC timeout, a missing manual-hook registration and a
five-second restart-test timeout. Traced repeats and later green gates did not
establish their causes. Issues #9, #19, #22 and #25 remain open. The first authority
probe incorrectly used stale 0.12.3 dist; only the corrected verified 0.14.0 controls
are release evidence.

Changed-cwd A → B → A may publish conflicting authority before daemon rejection
and retire B; same-project resume is the supported path. Pre-capture SessionEnd
ambiguity, termination before any committed authority, blocked synchronous kernel
I/O and pre-execution scheduling delays are not solved by this release. Internal
140/90 ms timers remain unchanged; the full-process temporary cap is below 300 ms,
with a 200 ms target.

Real vendor model conversations, Work/native idle wake, macOS execution, day-long
operability, physical subnet allow/deny and unattended Windows reboot remain open
acceptance gates. Synthetic Linux checks do not establish them.
