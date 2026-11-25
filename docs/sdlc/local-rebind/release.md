---
type: release
feature: local-rebind
status: released
version: 0.17.2
changelog:
  - "Fixed: established Claude reconnects no longer await unrelated outbox synchronization."
  - "Fixed: lifecycle fixtures retain primary failures when cleanup or diagnostic output fails."
breaking: []
---

# Kommutator 0.17.2

The release workflow proposed patch0.17.1; its unpublished immutable tag remains retained.
The corrected test-contract candidate advances to0.17.2, without rewriting that tag.
The following preparation history is retained; the completed publication checkpoint is below.

A previously registered, explicitly identified positive-generation Claude owner can
complete a fresh IPC hello and local operation lookup without waiting on another owner's
stalled hub response. Process birth, owner generation/lifecycle/session UUID, context,
durable end-marker and disconnect/shutdown checks remain. Pending owner lifecycle writes,
new registrations, hook callers, manual generation-zero and Codex keep the original path.
This does not eliminate hub dependencies from reads/mutation settlement or prove any
historical unknown operation uncommitted. Never blindly resend.

Lifecycle fixtures preserve both primary and cleanup errors and bounded pre-cleanup/
pre-kill evidence; a throwing diagnostic sink cannot change the outcome. Runtime hook
140/90ms timers and temporary strict300ms full-process limit remain unchanged.

## Investigation limits

Local0.17.0 log inspection03:17:28–15:40:07UTC found no new heartbeat/connection error
entries, only one obsolete shim retirement. Eighteen later bounded loopback probes all
returned expected unauthenticated401. These are not continuous, remote-client or day-long
qualification; prior storage waits and issues9/19/22/25 remain open.

## Not validated

Historical outage causes, safe blocked-queue disposition, native idle wake/Work, physical
outside-subnet denial, unattended Windows reboot and other platforms remain open gates.


## Candidate0.17.1 qualification interruption

The full local release gate and exact-head branch45649459503/tag45649789658 passed.
PR45649636476 failed the unchanged non-stalled Stop process test: output and all three
IPC methods were observed, but observations were empty at168.216ms. This is not a
failure of the new local-rebind regression. Source explicitly permits interruption of
best-effort diagnostic persistence at the140ms entrypoint deadline; the old test demanded
a terminal record regardless. A controlled reproduction and separate completed/interrupted
contract coverage are required; no blind rerun, relaxed deadlines or publication.
Tagv0.17.1 remains immutable/unpublished. GitHub draft creation returned502 and the
release does not exist. Timer restored and tentative16:05UTC service work deferred.


## Candidate 0.17.2 qualification interruption

Exact head 662d8f9262baf0c8947f5267c399241f5a465576 passed hosted branch
45651033438 and PR 45651040837 on their first attempts; secret scans also passed.
Independent ordered QA passed 870 workspace tests. The subsequent local full release
gate passed build/typecheck, 870 workspace tests, 161 script tests, audit, export
integrity and clean-PATH smoke, then FAILED the exported Claude E2E at the first
`whoami` after UI resume (test-plugin-export-e2e.mjs:159).

The tool returned `Shared daemon unavailable`. The preceding resumed SessionStart
exited zero in 174 ms; that does not prove registration completed. The compatibility
probe catches the underlying IPC error, so its precise phase/reason was not retained.
No timeout or storage cause is established. A successful hosted run does not explain
this local failure. Original log: /tmp/kom-v0172-release-check.log.

Publication and the tentative 16:20 UTC cutover are postponed. Production remains
0.17.0; deploy timer remains active. Notice 37e2682e-5b5a-4fab-bc98-3ffc1aff5f49
records the deferral. No 0.17.2 tag or release has been created.

A bounded availability collector was started independently of publication at
16:11:42 UTC on November 25. User unit `kommutator-availability-20261125.service`
limits runtime to 86460 seconds; the collector stops after 24 hours or 8 MiB.
It probes unauthenticated loopback every 10 seconds, disables HTTP proxies/redirects,
and records bounded process-birth comparisons and IO/memory pressure. This is
ongoing observation, not completed day-long acceptance or a promise of processing
feedback. Script SHA-256:
`1d649059191204d13859624983641178a1a43e70246bd155b3ede607df57cfaa`.


The corrected, instrumented bounded E2E passed at 16:14:01–16:14:33 UTC. It
recorded 257 IPC requests, 255 resolutions and two expected rejections, with no
IPC timeouts. The only failed daemon probe was initial expected ENOENT. Twenty-four
synchronous SQLite calls lasted at least 20 ms; the maximum was 236.561 ms during
startup. This did not reproduce or explain the original failure. Instrumentation
changes timing and is not release qualification. The first loader attempt missed
bundled identifier replacements and is explicitly invalid for IPC attribution.

The original failure lies in `requirePluginDaemon` before pinned Claude rebind.
CLI hello returns immediately; `daemon.status` takes the ordinary local snapshot
and starts background retirement reconciliation. Without the original error phase,
connect, hello and status request failures cannot be distinguished retrospectively.
A narrow allowlisted diagnostic preservation change is implemented; deadlines,
mutation retries and registration rules must remain unchanged.


Attempts to publish the new observations to issues #22/#25 failed via both GitHub
GraphQL and REST (server/502 responses). Subsequent read-only comment lists showed
neither new comment, so no remote issue update is claimed. Draft bodies are retained
privately; recheck server state before retrying to avoid duplicate comments.


Final diagnostic increment: independent correctness/security/external reviews approve;
ordered QA build/typecheck/887 workspace tests and 16 script diagnostic tests passed
first attempt. One controlled hook sample 205.709 ms exceeds the 200 ms target but
not the strict 300 ms temporary limit. The release artifacts are being regenerated
from the updated source; earlier 0.17.2 assets are superseded private candidates,
not published assets. Full release checks and exact-head CI remain required.


## Published checkpoint

Released at 2026-11-25 16:30:14 UTC from
`96bd3d20b44c70b10af8c5e7c2384557f98f9e48`. PR #38 merged afterward as
`5e72b9eac7bd17fd914241afe62676e217281d36`, so public matching assets preceded
installation catalogs. Exact-head branch 45653595169, PR 45653613340 and tag
45654174224 passed on their first attempts; corresponding secret scans passed.

Final full local release gate passed build/typecheck, 887 workspace tests, 162
script tests, audit, integrity, clean-PATH and exported synthetic E2E. Public assets
were downloaded anonymously and hashes matched. Real clean-profile Claude/Codex
installations started MCP 0.17.2; private setup returned 200 and foreign Origin 403.
These are synthetic MCP probes, not model dialogue or native wake acceptance.

Local plugin files were updated to 0.17.2. At this checkpoint production services
and loaded MCP remain 0.17.0; hooks/list still names 0.17.0 for the live root.
No trust changes were made. Announced local cutover is no earlier than 16:45 UTC,
notice 771b1587-6ba8-478f-ba8d-111b26cac2b0. Deploy timer is intentionally stopped,
service inactive/MainPID zero and lock free. Restore it after verified cutover.

GitHub writes recovered: issue #22 observation comment 7168055581 and #25 probe
comment 7168056033 are now published. Initial server errors remain historical.
The later [storage follow-up](storage-followup.md) records host checks and upstream
comparison without claiming a root cause.


## Local rollout completed

The ordinary pinned updater completed without manual reconciliation. Hub started
16:46:22 UTC, daemon 16:46:27 UTC, after the announced 16:45 UTC window. Hub,
shared daemon and actually loaded Codex MCP all report 0.17.2, contract 4.
Authenticated hub snapshot returns 200; caller active, role and both subscriptions
retained. The first ad-hoc authenticated `/version` probe returned 404 (no such
route); the corrected snapshot and in-container release constant verified health
and version. No credential was printed.

Current and VACUUM INTO backup databases passed quick_check (daemon 5, hub 8); both
hub indexes verified. Checkpoint idle/appliedVersion 0.17.2, timer restored. Old
blocked outbox 644 remains unchanged: aggregate degraded is expected, not hidden.
No queue entry was deleted or resent. Native hooks list all five 0.17.2 hooks
trusted/enabled without manual trust writes; fresh execution is not certified.
Live Claude MCP and remote daemon updates are not implied. Announcement:
`c31f34db-747f-4c44-b28e-0e52ad61dae7`.

The bounded observer remains active; only the recorded post-activation samples
are available, not day-long acceptance. See qualification and rollout evidence
in `spikes/evidence/2026-11-25-local-rebind-*.json`.
