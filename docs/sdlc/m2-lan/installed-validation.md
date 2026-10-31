# Installed M2 and deployment validation — 2026-10-27

> Public evidence redaction: personal home paths, interface names and network addresses
> are replaced with placeholders (192.0.2.0/24 and 198.51.100.0/24 are documentation ranges).
> They are not deployment instructions or measured endpoint values. Original records are retained privately.

The user explicitly requested the remaining checks on the installed configuration.
The earlier isolated M2 acceptance is separate from the installed-runtime checks below.

## Observed deployment checks

- Docker hub healthy, publication remains 127.0.0.1:8787.
- Client daemon healthy and connected; installed client key matches the hub file secret.
- HTTP snapshot rejects absent/incorrect keys with 401; correct key returns 200.
- WebSocket upgrade rejects absent/incorrect keys with 401; correct key opens successfully.
  The check closed immediately and did not create a fabricated host/session.
- WSL systemd enabled; Docker enabled and active. Windows task Kommutator-WSL-Hub is
  enabled/running at interactive logon, invoking Ubuntu-24.04 sleep infinity with no task
  execution time limit. This checks startup configuration, not actual Windows reboot.

## LAN application

A normal Windows UAC elevation was requested for the reviewed Apply script. The first
attempt was stopped by PowerShell execution policy before any networking change. A second
attempt uses ExecutionPolicy Bypass for that one elevated process only; no system policy
change is requested. Its UAC confirmation was pending at the last observation. No owned
LAN state existed; only Windows loopback listened at 8787 and WSL could not connect to
192.0.2.10:8787. That is evidence of closed LAN ingress, not a passed subnet firewall test.

Installed Codex and mixed-vendor evidence, restart recovery, and the final LAN outcome
will be appended after their runs complete.

## Installed Codex acceptance

Fresh owned roots used the installed user MCP configuration and Docker hub, without hook
trust bypass. The control observed five untrusted kommutator hook entries and successful
MCP identity. After backing up configuration, normal app-server config/batchWrite persisted
only those five exact current command hashes as trusted. A fresh owned app-server reported
all five trusted. Semantic comparison preserved unrelated configuration and existing trust.

Two independent roots in the same cwd then registered distinct identities, exchanged a
request and threaded reply, updated the test board using CAS, and retained the survivor's
identity/board after archiving the writer. During the run, doctor runtime.codex passed with
two live shims and observed PostToolUse/Stop polls. This proves the installed local engine
configuration, not an actual desktop UI or Codex idle native wake.


[Installed evidence](../../../spikes/evidence/2026-10-27-m2-installed.json) records 32
completed hook invocations and the live diagnostics. Trust is now configured; the previous
instruction to manually trust these unchanged commands is superseded by this check.

## Mixed vendor and restart recovery

Codex sent a test request to an idle owned Claude Code / Sonnet 5.5 session. Claude used
its native wake path with explicit per-session inbound accept, read the message and replied
in the same thread. Codex received/read the reply on its next prompted turn; this is not
Codex native wake. Both test messages were read and reply linkage/hops verified.
[Mixed evidence](../../../spikes/evidence/2026-10-27-m2-mixed-vendor.json).

The first mixed harness launch incorrectly used strict MCP without an explicit MCP config;
Claude's plugin hooks registered but the MCP tools were unavailable. Correcting the launch
arguments fixed the run without changing application code. Its never-delivered message to
an absent test handle left one blocked outbox row. After every owned root ended, the daemon
was stopped, its private state backed up with VACUUM INTO, and exactly that row was removed
using verified local session, replay key, method, complete params and error predicates.
No unrelated outbox or hub records were removed. The daemon was restarted afterward.

An additional owned root read its identity and test board, then waited while the parent
actually restarted the Docker hub. The daemon reconnected; a subsequent turn observed the
same session ID and exactly the same board body/version/author/update timestamp.
[Restart evidence](../../../spikes/evidence/2026-10-27-m2-hub-restart.json).
All owned app-servers, Claude processes and roots were closed. Labeled accepted test records
remain in the hub as evidence; the actual Windows reboot and desktop Work UI remain untested.

## LAN runtime defect found by actual Apply

The short-lived second UAC launcher timed out before confirmation and did not execute.
A subsequent normal elevation reached the helper. Windows rejected New-NetFirewallRule
with "The specified interface was not found on the system." The transaction rolled back:
no owned rules, state file or LAN listener remained. This validates closed-on-error behavior,
not successful LAN configuration. A disabled-rule diagnostic elevation was canceled; no
such diagnostic rules were created. Read-only New-NetFirewallRule -WhatIf subsequently
reproduced the interface validation error for a hidden Teredo alias without creating rules.
The correction and final application results are recorded below when complete.


The runtime fix was implemented in an isolated three-script copy and independently
reviewed. It inventories IPv4 interfaces instead of all hidden adapter records, preserves
VPN/WSL/Wi-Fi ingress blocks, and runs the actual firewall provider with WhatIf before any
mutation. Equivalent CIDR/netmask/range readback is compared as exact IPv4 intervals;
broader filters and ambiguous keywords are rejected. Reviewer and QA each passed 80
PowerShell checks plus the actual read-only Plan. The three scripts were integrated after
the develop gate returned proceed. [Review](validation-review-1.md).


## Final LAN state and acceptance boundary

The corrected Apply succeeded through normal UAC. Subsequent read-only Plan reported
AlreadyConfigured=true and validated all three effective rules and exact proxy ownership.
Only 127.0.0.1 and 192.0.2.10 listen on TCP 8787 in Windows; Docker remains loopback-only;
no IPv6 listener or diagnostic probe rule remained. The source restriction is
192.0.2.0/24 on REDACTED-LAN, with complement and other-interface blocks. HTTP missing/wrong
key returned 401 and valid key 200 through the LAN address; WebSocket rejected missing/wrong
keys and opened with the valid key. These checks originated on Windows itself, not a remote
physical LAN client. A first WebSocket assertion included an extra .NET void-task return
object in PowerShell output; suppressing that test-helper output made the rerun pass.

WSL-to-LAN TCP was reachable, but Windows Get-NetTCPConnection showed remote address
192.0.2.10 rather than the Linux socket's 198.51.100.10. Thus host NAT rewrote the source;
this cannot test the external-source block. The user confirmed no separate test machine
is available. External allowed/denied subnet acceptance remains unverified; local requests
are not substituted for it. [LAN evidence](../../../spikes/evidence/2026-10-27-lan-installed.json).

No further user confirmation is needed for the completed installation. Remaining distinct
acceptance gates are a separate physical LAN/outside-subnet client, actual Windows reboot,
day-long real usage and actual desktop Work UI / Codex native wake. The installed M2 hook
path and Claude native wake are verified within the scopes recorded above.

Final cleanup: client health is healthy, hub connected, outbox empty and all owned test roots
ended. The isolated LAN implementation snapshot was removed after reviewed integration.
Vault links and final review header validated; no Git commit or publication was performed.
