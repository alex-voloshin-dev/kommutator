---
type: release
feature: hook-import-isolation
status: approved
review_decision: proceed
version: 0.12.5
changelog:
  - "Fixed: close MCP resources on stdin EOF, including resources created by in-flight handlers."
  - "Changed: isolate the canonical IPC hello schema from unrelated hook startup imports."
  - "Fixed: keep daemon-only WebSocket and SQLite imports out of the client hook path."
  - "Fixed: test rejected hook registration independently of best-effort diagnostic persistence."
breaking: []
---

# Kommutator 0.12.5 development preview

Hooks now obtain pathsFor through the existing isolated paths export rather than
the daemon barrel. This removes unnecessary daemon module loading while retaining
the same IPC paths, registration, receipt and fail-open behavior. Runtime contract
and schemas are unchanged; internal 140/90 ms timers and the temporary 300 ms test
cap remain unchanged.

A bounded local A/B sample improved untraced median manual cold SessionStart from
160.641 to 138.933 ms and responsive Codex Stop from 151.998 to 124.676 ms. Claude
plugin SessionStart showed no meaningful median improvement. These observations
do not establish a CI latency cause or tail-latency guarantee. #9 remains open.

Ten unchanged-base lifecycle runs passed all 40 tests without reproducing #19.
Its original registration failure remains unresolved; this is not a registration fix.

## Validation and limits

A baseline-failing real-process test requires header output and exact ACK while
rejecting daemon-only module imports. Full qualification and review evidence is
recorded in review-change-3.md. Temporary A/B fixture ECONNRESET interruption and
its continuation are retained, not counted as a product fix.

No claim of real model conversations, native wake/Work, other platforms, physical
subnet behavior, unattended Windows reboot or day-long reliability.

Earlier 0.12.4 qualification passed 573 workspace and 140 script tests plus export smokes
and synthetic E2E. The first full run failed initial Claude registration; its cause
remains unknown. Diagnostic fixture hardening preceded the second passing run;
this is not evidence that the original registration issue is fixed.

## Superseded candidate

Version 0.12.4 was tagged and staged as a draft but not published. Its branch
push check (43135901281) failed because the rejection test required a final
`failed` observation but received `attempted`. PR 43135906663 and tag 43135917242
passed at the same commit without reruns. The final diagnostic write is explicitly
best-effort and may be interrupted; the exact interruption cause in CI is unknown.
The tag and assets remain immutable. Version 0.12.5 separates deterministic final
outcome testing from process rejection and registration checks. Earlier qualification of
0.12.5 was blocked; the 573/140 totals above describe the earlier candidate.

Two 0.12.5 full checks failed different Claude resume/retirement assertions: first
573 passed/1 failed, then 572 passed/2 failed. Both passed build/typecheck but did
not reach script/export checks. These are not resolved by the focused diagnostic
pass. Missing generation publication is observed; its cause remains unknown.
Those intermediate failures held publication until the reviewed corrections and
final qualification below. Their original cause remains unproven.


## Integrated correction and final qualification

A real-process negative control confirmed that the SDK stdio transport does not
close MCP on stdin EOF, leaving owned IPC and private setup resources alive.
The corrected MCP now initiates close once, rejects new work, fences delayed
client resolution and repeats idempotent cleanup after admitted handlers settle.
Tests cover an existing setup form, setup creation delayed across EOF, deferred
resolution/call cleanup and a second unaffected MCP connection. No shared daemon
shutdown, message replay or explicit session retirement was added.

The canonical IPC hello schema now has a narrow export shared by the root method
table. Validation, protocol version, PID/process-birth and generation fences are
unchanged. A baseline-failing bundled-import test and built-export reference
identity test verify the boundary. Six sequential intermediate cold-import samples
showed a 52.844 to 39.103 ms median; this is not end-to-end or historical-cause proof.

Fixture cleanup preserves body failures ahead of cleanup errors, labels operations
and signals only a verified disposable daemon after bounded normal shutdown grace.
Unknown ownership/exit retains evidence and fails cleanup. Independent reviews
approved the corrections; 27 final focused tests passed. Final full qualification passed 584 workspace and 140 script tests,
export verification, both clean-PATH smokes and synthetic E2E. The earlier failed results above remain part of the release evidence.
