---
type: release
feature: hook-import-isolation
status: approved
version: 0.12.4
changelog:
  - "Fixed: keep daemon-only WebSocket and SQLite imports out of the client hook path."
breaking: []
---

# Kommutator 0.12.4 development preview

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
recorded in review-change-2.md. Temporary A/B fixture ECONNRESET interruption and
its continuation are retained, not counted as a product fix.

No claim of real model conversations, native wake/Work, other platforms, physical
subnet behavior, unattended Windows reboot or day-long reliability.

Final qualification passed 573 workspace and 140 script tests plus export smokes
and synthetic E2E. The first full run failed initial Claude registration; its cause
remains unknown. Diagnostic fixture hardening preceded the second passing run;
this is not evidence that the original registration issue is fixed.
