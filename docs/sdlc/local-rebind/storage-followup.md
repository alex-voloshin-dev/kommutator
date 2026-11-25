# Storage follow-up, November 25

The bounded production observer recorded a birth-matched hub in D-state waiting in
`jbd2_log_wait_commit` before and after an 804.557 ms HTTP timeout at 16:12:32 UTC.
IO-full avg10 was 15.49%, memory-full zero. The first synthetic instrumented E2E
trace spans 16:12:27.568–16:13:02.191 UTC, overlapping this event. Its IPC loader was
incomplete; its contribution to shared-storage delay was not measured. This is not
proof that every outage, or the earlier failed exported gate, has this cause.

Read-only Windows checks later reported one SSD Healthy/OK and an NTFS volume with
48,443,449,344 bytes remaining out of 248,044,220,416. A later physical-disk counter
snapshot had zero current queue; a bounded System-event query for IDs
7/51/55/129/153/157 over 24 hours returned NoMatchingEventsFound. The first explicit
query-status command had a PowerShell quoting parse error; the corrected command
completed. None of these later samples rules out intermittent host storage latency.

## Upstream comparison

Microsoft's [PR #42057](https://github.com/microsoft/WSL/pull/42057) documents a
specific guest fsync slowdown after a buffered Windows reader of an attached VHDX
closes. It changes the retained backing-file handle to unbuffered access.
The [WSL 3.0.5 release](https://github.com/microsoft/WSL/releases/tag/3.0.5) includes
that change. This host's `wsl.exe --version` reports WSL 3.0.5.0 and kernel
6.18.58.1-1; guest uname agrees on 6.18.58.1-microsoft-standard-WSL2.

This comparison does not reproduce the upstream trigger, verify every installed
binary, or establish a local regression. It argues against blindly recommending
the already installed release as a proven cure. No WSL update, shutdown, kernel
change, disk repair, VHD scan/compaction, durability relaxation or stress workload
was performed. Future evidence needs correlated host and guest timing around an
actual failure, with production impact bounded. The current observer is limited
to 24 hours/8 MiB and is not completed day-long delivery acceptance.


Two further 800-ms probe timeouts occurred at 16:26:32 and 16:26:52 UTC while
local release qualification/exported E2E was active. Birth-matched hub snapshots
showed journal wait followed by folio wait, then folio wait on both sides.
IO-full avg10 was 18.91% and 3.91%, memory-full 6.35% and 0.89%. This reinforces
the observation of a shared-resource stall but does not quantify the qualification
workload's contribution or establish all historical triggers. Keep heavy qualification
isolated where feasible; any proposed resource/database architecture change needs
a measured comparison outside the production hub, not relaxed durability or deadlines.
