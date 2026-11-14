---
type: incident
severity: sev2
status: monitoring
impact: "A remote fleet reported delayed or failed hub operations; local loopback daemon failures corroborate multiple windows. Durable message loss is not established."
timeline:
  - "2026-11-12T17:02:07Z: local failed heartbeat; remote fleet reports the first interruption."
  - "2026-11-12T17:02:41Z: first retained order-7 allocation warning in the investigated window."
  - "2026-11-12T19:03:47Z: current hub container created during 0.12.6 deployment."
  - "2026-11-12T19:15:37Z: kernel allocation failure coincides with a reported remote disconnect; local daemon failures follow."
  - "2026-11-12T19:26:19Z: another local heartbeat failure, overlapping the remote recurrence."
  - "2026-11-12T20:08:28Z: previously authorized explicit hub restart; daemon restarted at 20:08:34Z."
  - "2026-11-12T20:13:00Z: resumed investigation verifies healthy 0.12.6 hub/daemon and active caller; time rounded to minute."
remediation:
  - "Existing reconnect behavior restored connectivity; current restart is not evidence of a root-cause fix."
  - "Preserved sanitized daemon/kernel timeline and began a bounded unauthenticated loopback endpoint probe."
  - "Do not replay ambiguous mutations, delete queue records, or load-test the live host."
action_items:
  - "Correlate direct and external-path probes with resource pressure and kernel warnings at the next recurrence."
  - "Add safe diagnostic distinctions for registration rejection and transport timeout after design/review."
  - "Design request-specific outcome reconciliation and owner-scoped blocked-outbox disposition."
---

# Recurrent hub availability degradation

Classification command: `af.py incident-classify --degraded` returned `sev2`.
The report describes intermittent degradation, no established durable data loss,
and no verified workaround. Automatic recovery is observed, not a reliable workaround.

Sources are peer reports `98636f54-7dc6-49d3-8f19-3740683f50ff`,
`a33d4377-790d-4fb7-96e6-7eb565b4030a`, `8b119385-e972-466d-a00d-203dd6679ea0`,
the local kernel journal and daemon log, and current container inspection.
The fleet size of 13 and remote probe outcomes are reporter observations, not
independently executed remote tests. Local events and limitations are retained in
[sanitized evidence](../../../spikes/evidence/2026-11-12-runtime-reliability-followup.json).

The kernel allocation/Hyper-V path is a correlated lead, not an established complete
root cause. Some interruption coincided with the known deployment; later recurrences
cannot all be attributed to that restart. No automatic kernel tuning, queue cleanup
or network exposure change was applied. A final resolved postmortem is premature.

The maintainer sent a substantive update in the original feedback thread
(`51e8a96d-ea93-4f3b-b5ce-242c02f8c955`), retaining ownership of investigation.

## 2026-11-14 follow-up (0.15.1)

Reclassification with `incident-classify --degraded` remains **sev2**: connectivity
recovers, but no reliable workaround or root cause has been established.
Peer reports place a new remote interruption at 15:54:29 UTC. Local Codex and Claude
heartbeat failures at 15:54:33 UTC independently corroborate the same time window.
Both precede the planned hub recreation at 16:00:12 UTC. A local Claude heartbeat
also failed at 16:05:04 UTC after deployment. The restart does not explain the whole
interval, and remote CPU pressure alone cannot explain the local observations.

Kernel warnings report failed order-7 allocation in the Hyper-V vmbus channel path
at 15:42:56, 16:02:14 and 16:03:06 UTC; these are correlated leads, not a proven
causal chain. The current hub container log contains its startup line but no error
for the inspected post-start window; it cannot establish pre-recreation behavior.
Sanitized local evidence is in
[the follow-up record](../../../spikes/evidence/2026-11-14-availability-followup.json).

No live stress test, kernel tuning, queue deletion or extra restart was applied.
Current services are healthy, but historical availability remains unresolved.
Next work is controlled transport lifecycle reproduction and content-free transport
phase evidence. Separate startup hook failures recovered to successful PostToolUse
observations; successful later execution does not explain the earlier failures.
