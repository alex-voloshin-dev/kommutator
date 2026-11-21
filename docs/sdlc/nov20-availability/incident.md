---
type: incident
severity: sev2
status: investigating
impact: "Reported remote send outcomes unknown during correlated local and remote hub connectivity failures; historical admission not established."
timeline:
  - "2026-11-20 21:06:25 UTC: remote reporter records heartbeat failures for twelve sessions."
  - "2026-11-20 21:06:40.810 UTC: hub-host daemon records a local Claude heartbeat failure with hub-unavailable."
  - "2026-11-20 21:07:01.741 UTC: reporter transcript records two unknown operation results."
  - "2026-11-21: maintainer verifies compatible MCP/daemon 0.16.1 and active caller; reads full reports and investigates offline preflight."
remediation:
  - "Current connection recovered; preserve queued work and uncertain outcomes without resend or deletion."
  - "Reproduce the Claude remote whoami preflight before local operation admission in isolation."
action_items:
  - "Qualify a local-authority preflight repair if controlled regression proves the defect."
  - "Obtain the exact second operation UUID and remote admission evidence."
  - "Continue issue 22 storage/workload investigation; do not attribute all incidents to prior D-state samples."
---

# November 20 availability and operation admission investigation

The incident workflow classified the observed partial service degradation without a
verified workaround as **sev2** (`incident-classify --degraded`). No data loss is proven.
There is no external alert connector; the signals are peer reports, local runtime
status, bounded logs and a read-only hub query. Recovery is observed, root cause open.

## Evidence and limits

Peer reports 84d3a44e-09a7-477c-b529-ede320823c21,
718100e9-84cd-41f9-9367-74af22936c8c and
fc451d8f-d33d-4583-9b7a-87bc62f34ba7 describe two parallel sends from a
Claude 0.16.0 client/daemon during remote hub-unavailable/WebSocket failures.
The local hub-host daemon independently recorded hub-unavailable at 21:06:40.810Z.
This corroborates a shared availability interval, not its underlying cause.

Surrounding updater runs finished idle at 21:03:55 and 21:09:55 UTC with
appliedVersion 0.16.1. No cutover is recorded in those runs. The bounded kernel
and Docker journal query for 21:04–21:10 returned no entries; absence of retained
logs does not prove absence of a host problem. The hub subsequently restarted
on November 21 at 17:35:40Z; that timestamp cannot explain the previous day's event.

A read-only query of messages for the supplied author session and the bounded
20:45–21:10 UTC interval returns the earlier send and the later feedback/pointer.
It does not find the two reported originals in that interval. This does not rule
out later admission, another identity or retained remote work. The hub stores a
separately generated replay key, not the MCP operation UUID; the local remote-daemon
observation mapping is required to establish correspondence. No payloads/tokens
were extracted. No database or queue was changed.

The reports disagree on the second operation UUID. The initial value is
`d5249f6e-53b9-453a-8626-f89bc5456a10`; the later value is
`d5249f6e-053c-4ee5-8f2c-bdeff6bf5f4f`. The original tool result was requested.
Do not silently select one or use a broad filesystem search as proof of non-admission.

## Controlled mechanism under investigation

ClaudePluginClient calls whoami before operation.submit. Daemon whoami flushes
and requests topic.list from the hub. Therefore a remote failure can prevent the
shim reaching local durable admission. A controlled regression can prove this
mechanism without proving it caused these historical calls. Any repair must keep
local owner/generation/process checks, existing retirement fencing and no automatic
mutation retry. It must not translate unknown into proof of non-commit.

## Local environment recovery

The user ran npm update under Node 24.22.3, introducing package-lock.json and
mixing npm packages into the contributor dependency tree. Tracked package manifests
and pnpm-lock.yaml were unchanged. The maintainer backed up user files, the npm lock
and the mixed node_modules outside Git, then installed the exact frozen pnpm lock
under Node 26.13.0 / pnpm 12.18.0. The running daemon uses a separate retained release
checkout, which was not modified. This is environment recovery, not a dependency upgrade.

## Remaining gates

Issue 22 remains open. Historical read errors, lifecycle/IPC failures and physical
subnet/reboot/native wake/day-long acceptance are not closed by this investigation.
The fresh failed PostToolUse observation lacks an error code; subsequent injected
headers prove some hooks executed, not that the failed sample was repaired.

## Follow-up qualification and bounded observation

The first full candidate suite failed three unchanged hub tests with 5/10-second
timeouts (migration rollback, migration setup, WAL backup). Build/typecheck passed;
protocol41 and hub206 passed, hub3 failed; later packages were not reached. An isolated
run of those exact three tests passed, which does not establish the original cause.
No thresholds were changed. Logs are retained in the implementation report.

A separate 60-sample observer from 17:45:42 to 17:46:44 UTC recorded the verified
working hub Node process in D-state: six journal waits and one page wait. Container
PID parent and exact process start ticks were independently matched. Other commands
were active, but workload contribution is unmeasured. This observation followed the
failed gate, so it does not explain its failures. See
`spikes/evidence/2026-11-21-storage-wait-observation.json`.

A second ordinary versioned full gate also failed three hub tests (206 passed),
with partially different failing scenarios. A subsequent diagnostic run instrumented
node:sqlite method duration without logging SQL/payloads and measured three exec calls
at 42.7–46 seconds. This localizes those diagnostic pauses inside synchronous database
calls, but does not establish the storage/device/workload cause. The instrumented run
is not release qualification. No timeout or durability setting was changed.
Further full qualification uses unchanged hosted CI to avoid repeating disk-heavy
local gates while the working hub shares the affected host. All local failures remain
part of the release decision and issue22 remains open.
