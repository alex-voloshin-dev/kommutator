---
type: implementation
feature: hub-link-shutdown
status: ready-for-review
---

# HubLink shutdown lifecycle

## Input and assumptions

Direct maintainer maintenance task: repair the independently reproduced callback-after-
close defect without attributing six release-gate test timeouts to it. No separate plan
or design is required for this scoped fix; DESIGN §19 records the shutdown contract
before implementation. Work stays in the dedicated candidate checkout. Prepared 0.16.0
version/catalog changes belong to the release orchestrator and are not part of this commit.

Relevant prior decisions: protocol-and-boundaries keeps transport close separate from
read receipts and remote mutation commitment; operability-evidence requires observed
results and preserves unexplained failures. Runtime contract/schema/replay behavior and
hook/IPC/request timeouts remain unchanged.

## Ground truth

A bounded isolated HTTP upgrade probe holds the connecting handshake, awaits HubLink
close, and records a later error callback. This reproduced on both built 0.15.2 baseline
and prepared 0.16.0 candidate. The defect is preexisting. Timestamps, source hashes and
observations are preserved in
[shutdown evidence](../../../spikes/evidence/2026-11-14-hub-link-shutdown.json).
The probe lives at /tmp/kom-hublink-close-probe.mjs and uses only loopback synthetic
servers; no live service or persistent runtime database was touched.

Two behavior tests failed before the source fix: the connecting socket invokes onError
after await close; a late asynchronous onConnect rejection invokes onError after close.
Never-started and already-closed controls passed. Red log:
/tmp/kom-hub-link-shutdown-red.log. All four initially passed after the fix; a fifth
checks cancellation of an in-flight request without replay or false confirmation.

The release-gate six timeouts remain unexplained. In its transport fixture, a pending
startDaemon promise can outlive a test timeout before its cleanup callback is registered;
this independent fixture ownership risk could leave startup running after home removal.
The observed cleanup ENOENT errors are not proven to have arisen from the reproduced
orderly-close scenario. This patch makes no such claim and does not add blanket catches
to the active filesystem logger. Active log write failures remain a separate concern.

## Implementation

- HubLink close shares one completion promise, rejects pending requests as unavailable,
  cancels timers and awaits the current local WebSocket close event after termination.
- Never-started/already-closed links return completed shutdown without creating a socket.
- Stopped or superseded socket errors/messages/open events cannot invoke application
  callbacks or report stale diagnostics. Error listeners remain installed to consume
  the socket's mandatory error event safely.
- Late asynchronous hello/onConnect failures are lifecycle-fenced. Shutdown does not
  await arbitrary application onConnect work forever; its continuation is suppressed.
- Unknown remote results remain unknown; no resend, receipt or replay-key change occurs.

## Validation

Initial build passed; typecheck caught three missing null guards for new test-server
addresses. Guards were corrected without changing assertions. The first attempt never
ran the full test suite. Logs: /tmp/kom-hub-link-shutdown-build.log and types.log.
Final ordered validation and independent review/QA are recorded below when completed.

## Limits

This is a local transport lifecycle repair. It is not a fix for all historical hub
availability events, test scheduling stalls, unowned timed-out fixture startup, active
logger disk failures or arbitrary application callbacks that perform their own work.
No production rollout, installed plugin changes or publication occurred in this task.

Final ordered build, typecheck and all 786 workspace tests passed (41 protocol,
208 hub, 243 agentd, 294 CLI). Logs: /tmp/kom-hub-link-shutdown-build2.log,
/tmp/kom-hub-link-shutdown-types2.log and /tmp/kom-hub-link-shutdown-tests2.log.
The unchanged standalone handshake probe was rerun against the rebuilt candidate:
no callback followed awaited close; the unchanged built 0.15.2 control still reproduced
its callback-after-close defect. Both observations are retained in versioned evidence.
Independent review, QA and integrated release:check remain required.
