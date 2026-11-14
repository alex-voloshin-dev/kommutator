---
type: release
feature: operation-error-diagnostics
status: released
version: 0.15.2
changelog:
  - "Fixed: return retained blocked operation evidence and safe rejection reasons instead of generic unknown errors."
breaking: []
---

# Kommutator 0.15.2

Tracked send/ack now return their durable blocked result, with an operation UUID
and fixed guidance. operation_status exposes allowlisted causes such as missing
topic membership, unknown recipient or unavailable reply parent. Arbitrary remote
error text is not reflected. Unknown/blocked never proves non-commit and does not
authorize resending or queue deletion. Existing owner fences and replay keys remain.

Runtime contract 4 and database schemas 5/7 are unchanged. Existing 0.15.1 MCP
forwards additive fields, but needs update for the new tool-error flag and guidance.
Third-party strict result-schema consumers need matching updated schemas.

Independent correctness/security/external review and QA passed; pre-release ordered
build/typecheck and 740 workspace tests passed. Exact-version packaging, public installation, CI and local deployment passed as recorded below.

## Not validated

Historical hub outages (#22), missing-registration triggers (#19), exported timeout
(#25) and large-backlog resync (#31) are not fixed by this patch. No new real model
conversation, day-long, physical subnet, unattended reboot or native Work acceptance
was performed. The old-MCP probe used source with candidate dependencies, not an
installed old-runtime qualification. No new eval case remains claimed as executed
without evidence.

## Retained qualification failure

The first exact-version ordered gate failed one of 740 tests: non-stalled Codex
Stop measured 450.480 ms against the unchanged <300 ms limit. The log is retained
at /tmp/kommutator-v0152-tests.log and issue #9 was reopened. An export was started
before this test process had finished, then interrupted before packaging; it wrote
separate output, not shared dist. No trace establishes a causal connection.
The initial release handoff used a mapping instead of the required changelog array;
validation rejected it and the array format was corrected before release.
A fresh qualification cannot explain the earlier timing failure.

Before repeating qualification, 24 isolated traced controls passed (nonstalled
123.603–151.557 ms, stalled 183.760–198.169 ms), followed by the unchanged
three-test process reliability file. Main-thread scheduler wait in those controls
was at most 2.742 ms. These do not explain the original untraced 450.480 ms sample.
See spikes/evidence/2026-11-14-hook-delay-controls.json.

## Exact-version qualification

The serialized second ordered gate passed build, typecheck and 740 workspace
tests. Full release:check then passed 740 workspace tests, 142 script tests,
export integrity, clean-PATH setup smokes and exported synthetic lifecycle E2E.
No successful rerun establishes the cause of the retained first failure.
Independent source reviews and 67-test QA passed before packaging. Public download,
CI and local rollout are subsequent gates, not implied by these local results.

Source and Git history scans found no secrets with the repository's exact-path
fixture exceptions applied. An initial absolute-path source scan did not apply
those exceptions; rerunning from its copied source root passed. Export scanning
flagged two checksum manifests; all 191 payload hashes per vendor were verified.
No credentials or runtime state are included in the source or client export.

## Published rollout

Release/tag 792108678e46ec7d54df99d8a7ca5e1b74106047; PR #32 merged as
704f66e75da3970a2fbb7e83bed6a95460af744c. All six branch/PR/tag CI checks passed.
Anonymous downloads and SHA-256 matched; clean-profile Claude 2.1.325 and Codex
0.167.2 installations launched MCP 0.15.2 and passed private setup/origin checks.
This is not a real model conversation acceptance test.

After the announced 19:35 UTC window, the pinned updater activated hub 0.15.2 at
19:37:08 UTC and daemon PID 3434453. Its restart command failed with IPC timeout;
the new daemon was already running. Independent status confirmed version 0.15.2,
contract 4, healthy connected state and empty outbox; actual container protocol
reported 0.15.2. Both live databases and both snapshots passed quick_check with
0600 permissions and schemas 5/7. The checkpoint was explicitly reconciled as
accepted and the timer restored, without retry, rollback or queue mutation.
The stale checkpoint result object still describes the previous successful updater
run; appliedVersion and inspected actual runtime establish the accepted deployment.

Reloaded chat MCP setup_status returned client_version 0.15.2 and compatible daemon
0.15.2; whoami confirmed the current active caller and both feedback subscriptions.
Historical hub-unavailable evidence remains, including a post-activation sample;
healthy current status does not explain it. No hook trust was changed.
Release announcement: 56f8c3e0-d756-404e-a906-61a1fc82b759.

A bounded local endpoint probe (unauthenticated GET /, expected 401, one-second
timeout) captured timeouts before activation at 19:36:23 UTC and multiple samples
19:37:17–19:39:35 UTC, beyond the container recreation instant. This confirms
observable local responsiveness failures during the maintenance period, not their
cause. Host/transport investigation continues; a 401 is not authenticated health.
