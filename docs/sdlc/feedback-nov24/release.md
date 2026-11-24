---
type: release
feature: feedback-nov24
status: released
version: 0.16.2
changelog:
  - "Fixed: registered Claude tracked mutations can reach durable local admission without a hub-dependent preflight."
  - "Fixed: unsuccessful Git project discovery no longer poisons later registrations."
  - "Fixed: validated cached management avoids installation writes on read-only filesystems, and watch reports local permission failures safely."
breaking: []
---

# Kommutator 0.16.2 — offline admission and client feedback repairs

Published 2026-11-24; [release](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.16.2),
PR #36 merged. Tag commit 4b10fdfbc681a8fb8df6222a13b322830d1e8202;
merge aaf62d64c84298da0b20d32508f73976b361ded8.

## Fixed

- Existing registered Claude owners preflight tracked send/ack through local operation
  lookup instead of hub-dependent whoami. UUID, authority fences and single submission remain.
- Negative Git remote discovery is retried; concurrent calls share a lookup and positive
  results stay cached. Existing sessions/topics/boards are not migrated. A Claude owner
  whose project context changes still needs a fresh session under the existing fence.
- Warm hosted management validates its immutable cache without installation writes/locks.
  Cold installs, MCP and hooks retain their paths; owner/mode/canonical/marker guards remain.
- Watch gives fixed EACCES/EPERM/EROFS guidance. The environment must still authorize
  Unix socket access; no sandbox bypass or arbitrary error reflection is introduced.

## Qualification and retained failures

Independent correctness/security/external reviews and QA completed. Full first-attempt
hosted checks passed on source 2d91b2f (45312208460,45312214957), final head 4b10fdf
(45312601077,45312607770) and tag (45312928220). Each full gate includes 830 workspace
and 161 script tests, build/typecheck, audit, integrity, clean-PATH and synthetic exported E2E.
Secret scans passed. Develop round 2 returned proceed.

Two local full runs failed and remain in [QA](qa.md). First: 5 agentd operation tests and 7
unhandled errors; A/B confirmed microtask-only waits could not await reissued Git I/O.
Exact persisted-phase waits retain every authority assertion; independent 47 operation,
7 project and 6 watch tests passed. Second: 4 hub SQLite timeouts, cause unknown; no third
blind local full run and no timeout/durability relaxation. Hosted success does not explain
those timeouts. Source scan has no findings; artifact scanner raw exit 1 had exactly 2
path-key license SHA-256 false positives, checked against actual bytes/manifests.

Public assets were downloaded anonymously and byte/hash verified. Actual clean Claude
and Codex CLI installs launched MCP 0.16.2, private setup 200 and foreign-Origin 403.
An initial probe lacked its configured CODEX_HOME directory and stopped before install;
corrected fixture passed. These probes are not real-model/native-wake qualification.

## Local deployment

After the 15-minute warning, pinned updater ran after 02:40 UTC. Hub started 02:41:27 UTC,
daemon 02:41:33 UTC; both 0.16.2, contract 4. Normal updater completed without reconciliation,
checkpoint idle/appliedVersion0.16.2. Both current databases and backups quick_check ok,
schemas 5/8 and hub indexes retained. Timer restored. Old blocked outbox 644 remains;
aggregate degraded is deliberately visible. No queue deletion/resend or schema downgrade.

Actual reloaded Codex MCP 0.16.2 verified, caller active, role and both feedback subscriptions
retained. Codex/Claude plugin files are 0.16.2; an already running Claude MCP was not separately
reloaded or certified. Five Codex hooks report trusted/enabled without manual trust writes;
this is not proof of their fresh runtime execution. Main was fast-forwarded after private
backup, preserving user files byte-for-byte; dev CLI rebuilt. Autonomous maintainer worker
remains disabled; feedback observer and deploy timer are active.

## Availability limits

The bounded 480-second loopback observer recorded 237 probes: 230 expected unauthorized 401,
6 timeouts and 1 URL transport error. 5 unsuccessful probes preceded the new container start,
2 followed it. IO-full avg10 peaked 44.31%; client scheduling/workload contribution and
underlying cause are unestablished. No per-probe process birth was captured. Do not describe
this as a fully stable interval or close issue #22. See [availability evidence](../../../spikes/evidence/2026-11-24-feedback-availability.json).

Unknown historical operations are not proven uncommitted or safe to resend. Remote daemons
were not upgraded. Issues #9/#19/#22/#25 remain open, as do day-long use, outside-subnet denial,
unattended Windows reboot, other-platform bundles and actual native idle wake.

Rollout announcement: b0255d68-dc3e-4632-a1d9-98a4184fbfdf.
Detailed [rollout evidence](../../../spikes/evidence/2026-11-24-feedback-rollout.json).
