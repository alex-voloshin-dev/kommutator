---
type: release
feature: project-context-recovery
status: draft
version: 0.18.0
changelog:
  - "Added explicit private checkout project selection for eligible new registrations."
  - "Fixed established Claude project drift after inferred discovery changes."
  - "Fixed Codex missing-registration and ambiguity recovery guidance."
breaking:
  - "Claude caller and daemon project assertions must match on first and repeated registration; previously ignored conflicting KOM_PROJECT values now reject."
---

# Proposed 0.18.0

NOT published, tagged or deployed. Code review and QA completed; exact-version release qualification remains in progress.

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
typecheck and916 workspace tests passed. Full release gate, final hosted CI,
public artifacts/installs and local rollout remain pending.

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
