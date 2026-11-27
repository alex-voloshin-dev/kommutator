---
type: incident
severity: sev2
status: investigating
impact: "Intermittent hub HTTP timeouts; current service recovered, historical operation outcomes remain uncertain."
timeline:
  - "2026-11-27 18:18–19:18 UTC: bounded observer completed 360 probes, 355 expected HTTP 401 and five timeouts."
  - "2026-11-27 21:42 UTC: separately requested service restart, outside the observed failure window."
  - "2026-11-27 21:46 UTC: MCP, daemon and hub 0.18.0 verified; caller active, shared daemon connected."
  - "2026-11-27 21:50–21:51 UTC: three further timeouts overlap mapped disk counters; IO issuer remains unknown."
remediation:
  - "Preserve current working service and blocked operations; do not restart or resend as an unproven storage workaround."
  - "Identify the actual Windows disk backing the WSL hub data and collect bounded read-only correlated observations."
action_items:
  - "Attribute concurrent IO to a process after capturing three failed probes with backing-device counters."
  - "Continue issue 22 investigation without relaxing SQLite durability or changing the kernel."
  - "Retain unknown operation results and investigate lifecycle failures independently."
---

# Storage correlation follow-up

The incident workflow returned sev2 for degraded service without a demonstrated
workaround. No data loss is established. Current availability recovered; this is
not a resolved postmortem.

## Completed hour

The final sample file contains 360 probes, 355 expected HTTP 401 and five
800 ms timeouts. There were 233 observations of 0.17.2 and 127 of 0.18.0.
One failure preceded activation and four followed it. All five captured matching
container/process birth and journal/folio waits. No later failure was recorded
after 19:03:58 UTC. The observer exited successfully at its duration bound.
The 21:42 user-requested restart cannot explain these earlier failures.

See [final evidence](../../../spikes/evidence/2026-11-27-final-hour-availability.json).
This is sampled HTTP availability, not day-long delivery acceptance.

## Backing storage

The Docker hub's data bind mount is on the WSL root ext4 filesystem (/dev/sdd).
The registered Ubuntu-24.04 distribution has an existing ext4.vhdx on C:.
Windows Get-Partition maps C: to disk 0; Get-Disk reports SATA, Healthy/Online.
The matching performance counter instance is PhysicalDisk(0 C:).
Health status is not a latency guarantee. Device counters cover other workloads
on that disk and do not identify which process caused a stall.

## New feedback

Message ec1de6b0-90ff-4691-95d5-1c5f6941b46f reports another Claude context
transition on older 0.16.1/0.17.2 components. Version 0.18.0 preserves an
established owner's inferred project; a newly eligible owner can still select
a new context. This does not establish the original historical trigger.

The report attributes recipient-not-found to differing project keys. Routing
actually requires a non-ended/non-gone exact handle and shared topic membership;
a project difference alone is insufficient. The source-backed distinction was
sent in reply fc1f08b7-78b4-488b-b9ee-0354e2769ec4. The four supplied shortened
operation IDs cannot identify full retained observations safely. No operation
was deleted or resubmitted.

## Separate hook signal

At restoration, status retained SessionStart and PostToolUse failures
(registration-rejected, ipc-hello), followed by successful PostToolUse records.
Registration is currently active. Later success does not establish the cause
of the earlier failures or resolve issues 19/25.

## Contemporaneous device observations

A separate 110-second guest observation completed with 11 probes: eight expected
401 and three timeouts. Ninety Windows samples completed successfully from
21:50:08 to 21:51:38 UTC, all counter statuses zero. Nine guest probes overlap
that interval, including all three failures at 21:50:36, 21:50:46 and 21:50:56.
All guest process births matched the running 0.18.0 container.

Each failed probe observed D-state journal/folio waits. At 21:50:46.547 UTC,
inside the second probe's approximately 802 ms interval, disk 0's sampled
average write latency was 209.205 ms (read 51.004 ms, queue 3).
The full Windows window peaked at average write 236.608 ms, average read
310.516 ms and instantaneous queue 255; these maxima are not all simultaneous.
This is contemporaneous evidence on the mapped backing device, stronger than
the earlier non-overlapping _Total snapshot. It does not identify the IO issuer,
a failing device, or a universal historical cause.

No load generator or service change was performed. Background IO and observer
overhead were not quantified. Host/guest UTC alignment has not been independently
bounded. Next, capture bounded process-specific IO attribution alongside these
signals, without dumping command lines, credentials or message contents.
Both collectors exited zero; neither is a permanent monitor.

See [correlated evidence](../../../spikes/evidence/2026-11-27-backing-disk-correlation.json).
