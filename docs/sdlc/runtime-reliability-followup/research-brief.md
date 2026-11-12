---
type: research-brief
feature: runtime-reliability-followup
status: complete
review_decision: proceed
date: "2026-11-12"
sources:
  - "spikes/evidence/2026-11-12-runtime-reliability-followup.json"
  - "spikes/evidence/2026-11-12-resumed-session-status.json"
  - "https://github.com/alex-voloshin-dev/kommutator/actions/runs/43286580724"
  - "https://github.com/alex-voloshin-dev/kommutator/actions/runs/43285839960"
  - "docs/sdlc/hook-registration-investigation/investigation.md"
  - "packages/cli/src/hooks.ts"
  - "packages/agentd/src/core.ts"
---

# Runtime reliability follow-up

## Scope and method

Investigate what new evidence after 0.12.6 establishes about issues #9/#19,
the restarted session's hook failures, and repeated hub interruptions. Two independent
read-only research tracks examined CI phases and hook lifecycle; the maintainer
correlated local host and daemon evidence. No production behavior, identity, deadlines,
kernel settings, credentials or queue records changed during investigation.

## CI: more ordinary samples, no reproduced historical failure

The main release-check run [43286580724](https://github.com/alex-voloshin-dev/kommutator/actions/runs/43286580724)
at `bd30dac20f71f56efa677b28b06c083f4c70bc17` and merge run
[43285839960](https://github.com/alex-voloshin-dev/kommutator/actions/runs/43285839960)
both passed 603 workspace tests and their separate four-hook phase samples.

| Measurement (ms) | Merge | Main |
| --- | --- | --- |
| Full-process hook durations | 98.756, 108.056, 94.859, 87.330 | 121.401, 113.130, 120.114, 110.389 |
| Parent spawn to entry | 21.701–23.505 | 26.045–27.783 |
| Delivery import | 30.588–31.026 | 39.939–42.852 |
| Queued registration to local save | 9.752–12.471 | 11.318–14.416 |
| Cumulative main-thread scheduler wait at hook exit | 0–0.033 | 0.002–0.314 |

No deadline or incomplete-instrumentation marker occurred. Four samples per run do
not establish a performance regression or explain previous failures. Logs were retained
locally at `/tmp/kom-ci-43286580724.log` and `/tmp/kom-ci-43285839960.log`.

The workflow's diagnostic step is a **separate invocation** after the release gate
(`.github/workflows/release-check.yml`). Its `shares one daemon` filter selects absent/stale
socket lifecycle cases with an already started daemon before author/reviewer hooks,
not the true cold SessionStart budget case (`packages/cli/test/process-lifecycle.test.ts`).
Consequently a failing untraced gate can still have no same-invocation phase evidence.
The loader records queue/birth/save/flush, but not pending-ticket selection/wait/recheck
(`scripts/fixtures/lifecycle-phase-trace.mjs`). These successful samples do not establish
that the 250 ms recovery wait was exercised.

Preserve the earlier 601/603 gate, zero-hello failure and 375.141 ms cold hook, and
the 310.501 ms untraced outlier as unexplained. The controlled accepted-registration
race fix and the measured scheduling contribution to a separate 207.380 ms sample
remain valid but narrower evidence; see the prior investigation and 0.12.6 release record.

## Restarted Codex hooks

Fresh tools verified MCP and daemon 0.12.6, contract 3, an active caller, both
feedback subscriptions and empty outbox. A new timestamped [sanitized tool snapshot](../../../spikes/evidence/2026-11-12-resumed-session-status.json)
retains setup/status/whoami facts and their matching caller identity. Docker inspection
independently identifies the running healthy hub image as release 0.12.6. Installed version and loaded MCP now agree.
The retained daemon log records this root becoming gone at 20:10:34.391 UTC because
its old process exited. Hook observations show generic failures through 20:13:20.910,
then successful outcomes from 20:13:33.306 onward. Selected records for the same
`current-root` alias are preserved in the evidence JSON. The maintainer observed
fresh MCP activity during this interval, but no timestamped registration response
was retained: the exact before/after correlation with registration is unverified.

Only the Codex shim creates/revives a root; hooks bind an existing root
(`packages/agentd/src/core.ts`, Codex `ipc.hello` branch). A missing/gone root raises
`-32020` (`packages/agentd/src/binding.ts`). `runHook` classifies this and other generic
errors as `failed` (`packages/cli/src/hooks.ts`); its observation ring does not retain
the exception. A pre-registration hook rejection therefore explains the sequence
plausibly, but the historical exception is not recoverable. Do not claim proven cause
or a trust-approval problem. Success can mean an empty poll, not necessarily delivery.

## Hub availability: new host-level evidence

See [incident](incident.md) and the sanitized
[evidence](../../../spikes/evidence/2026-11-12-runtime-reliability-followup.json).
The local daemon uses loopback and also logged errors during remote reported windows,
including 19:08, 19:15 and 19:26 UTC. Between 17:00–20:00 it recorded 54 connection
failures, 19 failed heartbeats and six unverified-liveness events.

The kernel emitted 60 order-7 allocation failures in `vmbus_alloc_ring` / `hvs_probe`,
including 19:15:37, and memory-pressure notices at 18:50:05 and 19:13:56. Counts are
rate-limited warning emissions, not all allocation attempts. The 19:15:37 buddy lists
show no free blocks of 512 KiB or larger in either listed zone. This is evidence of
failed high-order allocation during the incident, not an OOM kill or proof that
Kommutator leaked memory. The host's kernel reports `6.18.58.1-microsoft-standard-WSL2`.
Microsoft's [VMBus implementation](https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.18.y/drivers/hv/channel.c)
and [Hyper-V socket transport](https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.18.y/net/vmw_vsock/hyperv_transport.c)
support investigating this allocation/transport path; the moving branch is not proof
of the exact running binary. Correlation does not establish whether transport failure,
general host pressure, or another factor caused each application timeout.

The current container was created at 19:03:47.315 UTC; its listener logged startup at
19:03:48.246 during the 0.12.6 deployment. This supports a deployment interruption
then, not all recurring outages. Its restart counter is not a history of replaced
containers. Historical Docker events returned none; this is a retention gap, not proof
that no previous restart occurred.

A bounded 60-request unauthenticated loopback `/version` probe from 20:14:51 to
20:16:51 UTC returned HTTP 401 on every request, 1.527–63.300 ms. This confirms
listener responsiveness and authentication rejection during that sample, not an
authenticated end-to-end operation or remote LAN availability. Samples, including
CPU/memory/I/O pressure, are retained in the evidence JSON.

A later peer report (`2d575909-aa98-42e4-92fe-d8f067c01308`) adds errors at
20:08:27–28 (matching the explicitly requested local restart) and 20:11:38–20:12:01.
The latter is not explained by that restart. Kernel allocation warnings also occurred
at 20:10:24, 20:10:44 and 20:10:58; no exact warning was observed at 20:11:38.

## Recommendations

1. Keep #9/#19 open. Next bounded experiment: instrument pending-ticket wait/recheck
   in the existing isolated 200 ms registration-delay control, with a separately
   installed old-core negative control and unchanged first identity assertion.
   Pair true cold traced/untraced hooks; preserve every failure. Do not share mutable
   dependency links, increase timers or retry the gate into a pass.
2. Capture simultaneous loopback and external-path availability, event-loop delay,
   kernel allocation warnings and memory/CPU/I/O pressure during a recurrence. Do not
   reproduce memory pressure deliberately on the live hub host. Kernel/configuration
   remediation needs its own reviewed evidence and interruption plan.
3. Improve bounded hook diagnostics by distinguishing registration rejection from
   transport timeout using fixed safe categories, without copying arbitrary error
   messages or altering identity authority. Existing generic `failed` cannot explain
   these events retrospectively. This is a proposed change, not implemented here.
4. Specify owner-scoped request reconciliation and blocked-outbox disposition before
   adding cleanup or retries. Current send enqueues before flush (`core.ts: send`),
   but failures before that point are possible. An IPC timeout or unchanged queue
   depth cannot prove that a mutation was neither persisted nor committed. Never
   bulk-delete pending/blocked rows or blindly resend; preserve replay keys and CAS.

No release is warranted from documentation/evidence alone. Current connectivity is
restored, while recurrent host availability remains an open incident; short probes
cannot satisfy day-long, independent subnet, reboot or native-wake acceptance.
