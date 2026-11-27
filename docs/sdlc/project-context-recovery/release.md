---
type: release
feature: project-context-recovery
status: final
version: 0.18.0
changelog:
  - "Added explicit private checkout project selection for eligible new registrations."
  - "Fixed established Claude project drift after inferred discovery changes."
  - "Fixed Codex missing-registration and ambiguity recovery guidance."
breaking:
  - "Claude caller and daemon project assertions must match on first and repeated registration; previously ignored conflicting KOM_PROJECT values now reject."
---

# Kommutator 0.18.0

Published immutable tag v0.18.0 at0748dd438873f08c5b624b37e8a996ffb40f5a07.
Public assets, clean installs and local rollout verified; availability limitations below remain.

The prefix-only release helper suggested0.17.3 because implementation commits
used fix prefixes. Maintainer selects0.18.0 based on actual behavior: a new
operator CLI/configuration feature and an intentional pre-1.0 compatibility
tightening. No existing tag or artifact will be replaced.

## Compatibility and safe recovery

Established exact Claude owners keep registered context when inferred remote
changes, including intentional Git initialization. Explicit caller/daemon project
assertions must agree from the first registration; remove/correct stale
KOM_PROJECT rather than repeatedly restarting into the same conflict.

Checkout selection is a deliberate private local-operator action. It affects
eligible new registrations after daemon activation; existing contexts stay pinned.
Claude can activate through a new OS owner or genuinely new conversation under
existing generation fences; Codex needs a new independent root. Both board
histories remain separate and unchanged. No bulk migration or automatic alias,
new private-message inheritance, guaranteed handle restoration or current-seat
reassignment is included. Reserved topic membership remains enforced.

## Retained investigation limits

The completed sampled availability observation includes four timeouts, one on
0.17.2 in a birth-matched journal wait after a separate user-requested restart.
This release does not claim its storage root cause fixed, nor resolve all
historical registration/IPC failures or unknown operations. No queue deletion,
blind resend, receipt relaxation or hook deadline increase occurs.

## Qualification state

Baseline repaired expectation failed old core at project conflict. Initial
no-dist baseline executed no tests. First implementation typecheck failed on
Stats union typing; first focused suite exposed shutdown continuation failures;
both were repaired. Integrated e628bc8 build/typecheck and910 tests passed,
but external review found a stale supersession snapshot after an awaited probe.
Baseline reproduced that defect; cfb1a53 reloads and fences owner state after
await. Independent correctness/security/external round2 reviews approve.

Independent QA95e73d2 added process CLI/startup, bounds/descriptor and divergent
board-history coverage. First full QA run passed552 and timed out3 agentd tests;
CLI did not run. Unchanged focused218+4 passed, then one ordered repeat passed
916. The timeout causes remain unknown. Exact-version0.18.0 ordered build,
typecheck and916 workspace tests passed. Subsequent full local release gate failed914/916 on two unchanged operation-timeout
IPC cases; later script/export phases were not reached. Both focused cases then
passed unchanged; initial incorrect-filter command ran no tests. Cause unknown,
tracked in issue25 comment7225796536. Separately162 script tests, export integrity
and clean-PATH smoke passed; synthetic exported E2E was still running at this note.

Full hosted gates on c3ceb3e passed first attempt: branch46051379328 and
PR46051387732, with secret scans46051379280/46051387740. These execute all916
workspace and162 script tests plus audit/integrity/clean-PATH/exported E2E.
Maintainer qualification accepts the bounded repairs based on independent reviews,
QA, ordered exact-version tests and two complete hosted gates, retaining local
failures as unresolved rather than declaring the local full gate green.
Final head0748dd4 branch46051701547, PR46051707574 and tag46051993703 full
release gates passed first attempt; secret scans46051701745/46051707693/46051993661
passed. Separate local exported E2E completed successfully. Anonymous public
archives matched pinned hashes; real clean vendor CLI installs started MCP0.18.0,
private setup200 and foreign Origin403. These are synthetic MCP probes, not real
model dialogue. Local rollout subsequently completed as below.

Source-history scanning initially flagged synthetic `handoff/marketing` board
entry keys. A precise path AND literal-value exception retains the detector;
subsequent full-history scan found no leaks. Independent security review approved
this scope. Raw failures are retained. Artifact scan still exits1 on two runtime
metadata SHA-256 values; both equal actual path-key license bytes
(48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0),
not credentials. This is a reviewed false positive, not a raw successful scan.

## Not validated

Real model dialogue across all clients, native Work/idle wake, day-long message
delivery, physical subnet denial and unattended Windows reboot remain open.
Sampled HTTP401 response observation is not authenticated delivery acceptance.

## Local rollout

PR39 merged as8bb814b0d4dc9e3ed7c0dbb02668ef6cfbf7a849 after public assets and
installation verification. Announced earliest interruption18:55UTC; actual hub
start18:56:48.209911355UTC and daemon18:56:54UTC. Ordinary pinned updater completed
without reconciliation. Runtime hub/daemon and loaded Codex MCP0.18.0, contract4,
caller active/connected; role and both feedback subscriptions retained.
Current databases and VACUUM INTO backups quick_check OK, schemas5/8 and hub indexes
verified. Timer restored, checkpoint idle/appliedVersion0.18.0. Old blocked644
unchanged; aggregate degraded. No current-seat selection or board migration applied.

Local Claude/Codex plugin files upgraded; native hooks/list reports five trusted
enabled0.18.0 hooks without manual trust changes. New-content execution and live
Claude/remote MCP upgrade are not certified. Current root identity was observed
after standard MCP reload, not copied from a prior session.

Bounded observation also captured one pre-activation timeout on0.17.2 and two
after activation on0.18.0, with birth-matched hub journal/folio waits. Services
subsequently responded, but this is not a fully stable rollout or an established
storage root cause. Updater preparation/plugin reload overlap some windows; their
contribution is unmeasured. See issue22comment7226082541 and
[availability evidence](../../../spikes/evidence/2026-11-27-project-context-availability.json).
Announcement8ba3d287-68cd-40d2-9712-f40f1faae759 and availability follow-up
904c90c1-bf44-4526-8a3a-ae4deb1dfc42 were confirmed sent, not proof of reader action.

Later fixed snapshot through19:03:58UTC:276 probes,271 expected401, five timeouts
(one before activation, four afterward). Additional19:02:38/19:03:58 failures
again matched D/jbd2 before and after; low sampled avg10 pressure does not exclude
short stalls. This supersedes the earlier three-timeout count for the longer
window; the bounded collector remains active and no final one-hour claim is made.
