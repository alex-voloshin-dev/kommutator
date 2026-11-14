---
type: release
feature: bounded-resync
status: qualified
version: 0.16.0
changelog:
  - "Added: negotiated bounded delivery recovery pages and fair owner scheduling."
  - "Fixed: large unread recovery bursts repeatedly disconnecting before synchronization completes."
  - "Fixed: transport shutdown waits for socket closure and fences late callbacks."
  - "Fixed: recovery work and pending wakes stranded across worker completion or verified owner refresh."
breaking:
  - "Hub database schema upgrades to 8; older hub readers reject it. Back up and fix forward, never automatically downgrade or restore old history."
---

# Kommutator 0.16.0

A hub and daemon that both support bounded recovery transfer unread deliveries in
pages of at most 32 deliveries and 512 KiB of encoded result. Separate transient
scan cursors preserve read receipts and replay state. Fixed highwaters and owner
round-robin scheduling prevent one recovery backlog from monopolizing all owners.
Authority and connection-epoch checks discard stale pages; verified owner refresh
requests a fresh pass and rearms eligible pending waking work under current policy.

Hub schema 8 adds indexes for unread range and message-target reconstruction.
Supported upgrades from schemas 5, 6 and 7 are atomic; old readers reject schema 8.
Back up with VACUUM INTO and use fix-forward recovery. Local daemon schema 5 and
runtime contract 4 are unchanged. Both the hub and daemon must be upgraded for this
fix: legacy negotiation remains supported and retains the old large-burst limitation.
Updating an installed plugin alone does not prove its shared daemon has upgraded.

## Controlled qualification evidence

The baseline real-socket scenario with 200 unread 60,000-character bodies repeatedly
reconnected without completing. The candidate recovered all 200 over one connection
in 3,628 ms with no receipt advancement. Its short 1,800 ms observation was incomplete,
not a failed transfer. A new hub with a legacy client still reproduces the old limit.

A disposable 100,000-row schema-7 fixture migrated in 72.828 ms, preserving all eleven
table hashes/counts and receipts. This single synthetic observation is not a guarantee
of production migration duration. Review-found races and their red/green regressions
are retained in implementation.md. Final independent correctness/security/external reviews and QA passed with 781 tests. Separate shutdown review and QA passed
with 792 workspace tests, including active-error positive controls and fixture
startup ownership regressions.
The qualification and rollout checkpoints below supersede this preparation snapshot.

## Not validated or fixed

Historical availability #22, missing-registration #19, exported IPC timeout #25 and
intermittent hook latency #9 are not collectively explained or fixed. During the
0.15.2 rollout, local endpoint timeouts and memory/IO pressure were observed; their
cause is still under investigation. Bounded resync fixes the independently reproduced
burst, not arbitrary incoming floods, paused peers or all host resource stalls.

No new real-model native Work/idle wake, physical subnet, unattended Windows reboot
or day-long acceptance is claimed. Unknown/blocked operations still do not establish
non-commit and never authorize blind resend or queue deletion. Remote installations
require their own version and connection checks.

## Retained exact-version packaging failure

The first 0.16.0 ordered build/typecheck/781-test gate passed. The subsequent full
release:check failed in agentd: six five-second timeouts across four test files and
two uncaught ENOENT log writes after fixture directories were removed. Log:
/tmp/kommutator-v0160-release-check.log. No release/tag was published. The prepared
/tmp/kommutator-v0.16.0-assets archives are rejected qualification material and must
not be uploaded as the final release.

The unchanged live 0.15.2 hub also had a healthcheck timeout at 20:13:26–20:13:31 UTC.
This corroborates a contemporaneous responsiveness problem beyond the isolated
candidate, but does not establish the cause of any individual timeout. Resource
pressure observations remain distinct from proof of application or kernel cause.

A separate controlled probe reproduced a preexisting HubLink close-order bug on
both built 0.15.2 and the candidate: callbacks can occur after close resolves. Its
narrow repair is tracked in docs/sdlc/hub-link-shutdown/ with separate review and
QA; it is not asserted to explain the six timeouts or every fixture cleanup error.
Release qualification must be repeated after that repair, with newly built assets.
The proposed 20:20 UTC maintenance was cancelled; a new window needs 15-minute notice.

## Second qualification failure

The second packaging gate passed build/typecheck, then failed two hub cases:
a migration test exceeded its 5-second deadline and persistence setup exceeded
its 10-second hook deadline. The existing live 0.15.2 hub main process was sampled
in D state waiting in jbd2_log_wait_commit during the same interval. TCP connects
succeeded while eight HTTP responses timed out. This establishes storage-wait
involvement in the observed live incident, not the exact candidate-test syscall or
the underlying device cause. A concurrent broad /tmp file search by the maintainer
was stopped and is an explicit workload confound. No deadlines were relaxed.

A subsequent separate two-file diagnostic passed 11 tests under restricted syscall
tracing; its maximum observed fsync was 111.401 ms. Tracing changes timing and this
short pass neither explains the failed run nor substitutes for release qualification.
Logs: /tmp/kommutator-v0160-release-check-round2.log and
/tmp/kom-v0160-migration-traced.log. A third full gate runs without concurrent
recursive search or qualification workloads, retaining bounded resource observation.

## Third qualification failure and diagnostic correction

The third full gate passed 792 workspace tests, 142 script tests, export integrity
and both clean-PATH client checks. Exported E2E then timed out owner-2 SessionStart
at 2,005 ms; owner-1 had completed at 856 ms. Original child phases were not saved.
Log: /tmp/kommutator-v0160-release-check-round3.log. No publication occurred.

Its birth_matches:false fields are not evidence of process identity mismatch:
the diagnostic compared ps lstart text with the newer canonical Linux birth token.
That independently confirmed diagnostic defect is being corrected separately.
During a conservative nearby observation interval the live hub remained responsive;
the preceding journal-wait episode must not be used as this hook's established cause.

The corrected diagnostic at a8a2368 passed one instrumented exported E2E, including
long-lived Claude resume, concurrent owners, offline queue recovery and shared-daemon
restart. This pass did not reproduce or establish the cause of the original timeout.
Independent final QA and full release qualification remain required.

## Fourth integrated gate: usable phase evidence, release still blocked

Final independent diagnostic QA passed build/typecheck, 792 workspace tests and
151 script tests. All three review lenses approved final d30400e. The fourth full
gate passed those tests plus clean-PATH smoke, then exported E2E failed on a
purposefully stale PostToolUse after successful Claude resume. Started at
20:56:47.427 UTC, spawn/stdin completed in 2 ms; timeout was 2,004 ms. Sampling
started at 1,503 ms but was still pending at the deadline, so no child state was
captured. Canonical birth comparisons were true. The current B journal differs
from the fixture's original A vendor ID by design after resume; it is not evidence
of wrong registration. Log: /tmp/kommutator-v0160-release-check-round4.log.

The next finite diagnostic observes the disposable E2E process tree externally,
without sharing its Node filesystem worker pool, alongside restricted syscall
tracing. Instrumentation is not qualification. The candidate remains unpublished;
no new maintenance window, tag, merge or 0.16.0 service activation has occurred.

## Maintainer release decision and public installation checks

Released as 0.16.0 at e1ddc59; PR #33 merged as bd9f7f9. Three first-attempt full
exact-head CI gates (branch, PR and tag) passed, with independent correctness,
security, external review and QA: 792 workspace tests and 151 script tests. This
is the full-pipeline qualification basis. The four failed local integrated gates
above remain failures; their hook timeout causes are not established. A passing
external-only E2E did not reproduce them. Ptrace changed timings and failed a
different SessionEnd assertion; it is not qualification. Independent QA reviewed
this residual risk and found no new concrete regression blocker for the scoped
repairs. Issues #9/#19/#22/#25 remain open.

Both public archives were downloaded anonymously and matched SHA-256. A fresh
export matched the packaged export's complete SHA256SUMS. Clean real Claude and
Codex CLI installations launched MCP 0.16.0 with Node 26.13.0 and passed private
setup/foreign-Origin checks. This is not real-model conversation evidence.
See [qualification evidence](../../../spikes/evidence/2026-11-14-bounded-resync-qualification.json).

Local deployment is scheduled no earlier than 2026-11-14 21:25 UTC after the new
15-minute notice. Timer stopped, updater drained and lock verified free. Actual
service migration, backup integrity and resumed client checks remain a separate
rollout checkpoint; no automatic rollback is permitted.

## Verified local rollout — 2026-11-14 21:32 UTC

Pinned cutover selected e1ddc59 / 0.16.0 after the announced 21:25 UTC earliest window.
The non-root isolated image smoke passed. Docker hub started at 21:31:04.991 UTC;
actual hub package, shared daemon PID2079962 and this session's loaded MCP are 0.16.0,
with runtime contract4. The caller is active with its role and canonical feedback topics.
SessionStart and PostToolUse success observations were returned after the chat restart;
no hook trust was modified.

Both current databases passed quick_check with schemas5/8 and mode0600. Both new hub
indexes exist. VACUUM INTO backups passed quick_check with original schemas5/7 and
mode0600. The updater reached activation but blocked at its aggregate-health gate:
one pre-cutover reply to an absent remote recipient remained blocked. This was not a
restart IPC timeout. Independent runtime and database checks justified explicit
reconcile accept; checkpoint is idle/appliedVersion0.16.0 and timer is active.
Aggregate health remains degraded for outbox644, operation
b2c4332d-c885-4f6b-9f1d-7997b51c3ba5, recipient-not-found. That work was neither
removed nor resent. Acceptance records deployment, not resolution of the blocked work.
The checkpoint's nested result.version0.15.1 is historical, not the running version.

Announcement: 0765ffb1-55b4-45ac-98e9-3ab8fe68eda5 in kommutator-feedback.
This confirms hub storage/routing, not recipient read. Remote daemons were not updated.
The previous bounded observer stopped during chat restart; it does not cover the entire
cutover. A separate 120-second observer was started during final activation.
See [rollout evidence](../../../spikes/evidence/2026-11-14-bounded-resync-rollout.json)
and [assessment](deploy-status.md). No historical timeout issue or extended acceptance
gate is closed by this short deployment observation.
