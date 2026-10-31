---
type: onboarding
feature: local-hub-readiness
status: final
date: '2026-10-25'
components: [packages/protocol, packages/hub, packages/cli, packages/agentd]
entry_points: [packages/cli/src/commands.ts, packages/hub/src/index.ts]
conventions:
  - Node 24 and pnpm 10.18.0
  - Build before checks; dependencies installed separately on each OS
risks:
  - LAN access from another machine remains unverified
  - Reboot/logon startup remains unverified; before-login startup is not configured
---

# Local hub readiness

> Public evidence redaction: personal home paths, interface names and network addresses
> are replaced with placeholders (192.0.2.0/24 and 198.51.100.0/24 are documentation ranges).
> They are not deployment instructions or measured endpoint values. Original records are retained privately.

**Current deployment:** Docker now replaces the temporary native hub service. See
[Docker implementation and checks](../docker-hub/implementation.md). Earlier sections below
preserve inspection/setup history; they do not authorize restarting the retired native unit.

This inspection checks hub readiness, not client vendor acceptance. Source mapping was
independently delegated and verified against CLI commands, hub database/server code and
DESIGN sections 11–13. Existing architecture notes remain valid; the initial onboarding
scaffold table is historical. See [deployment requirements](../../knowledge/hub-deployment-requirements.md)
and [WSL hub runbook](../../WINDOWS_LAN_SETUP.md).

## Observed environment

- Current runtime: Ubuntu 24.04.5 under WSL2, Linux x86_64; Node 24.22.1 and pnpm 10.18.0.
- Dependencies and dist were already present; all workspace packages rebuilt successfully.
- About 948 GiB free on the repository filesystem. systemd is PID 1.
- WSL address at inspection: 198.51.100.10. Windows Ethernet address: 192.0.2.10.
- No listener on 8787 in WSL or Windows at inspection; no matching user systemd unit.
- KOM_KEY, KOM_HUB_DB, KOM_HUB_BIND and KOM_HUB_PORT unset in the inspected shell.
  This does not rule out configuration in other shells or external service managers.
- Windows Ethernet and VPN network profiles are Public. No firewall rule with kommutator
  in its display name was found; effective firewall reachability was not tested.

## Executed validation

- `pnpm -r build`: passed for all four packages.
- `pnpm -r typecheck`: passed for all four packages.
- `pnpm --filter @kommutator/protocol --filter @kommutator/hub test`: 30 + 141 passed.
- `pnpm test:hub-smoke`: passed all nine checks on Linux: HTTP auth, dashboard, snapshot,
  two-host registration, send/deliver, marked-read, online backup, restart persistence,
  backup restore. Temporary processes/data were cleaned by the harness.

Full agentd/CLI tests, remote LAN access and real Claude wake
were not tested. The smoke uses loopback and simulated host connections, not other PCs.
No persistent hub was started; no firewall, network profile, key or system service changed.

## Remaining setup

For an immediate foreground WSL hub, the software is ready: supply a shared key (minimum
16 characters, runbook recommends 32 or more), create a private persistent data directory,
set KOM_HUB_DB, and run `node packages/cli/dist/index.js hub run`. Loopback is the default.
A persistent service also needs explicit supervision/autostart and a protected environment
file. WSL LAN exposure needs a separate connectivity setup and a test from another machine;
the current private WSL address is not the Windows LAN address.

The user corrected the target: this WSL distribution hosts the hub. Native Windows
Node/pnpm installation is irrelevant to readiness. Earlier Windows-target statements were
an incorrect assumption and are superseded, including the historical transfer audit target.

## Hardware and service recheck

Observed on 2026-10-25 after the target correction:

| Resource | Observation |
| --- | --- |
| CPU exposed to WSL | Intel Core i5-9500T, 6 logical CPUs / 6 cores, x86_64 |
| WSL memory | 7.7 GiB total; about 6.5 GiB available |
| Swap | 2 GiB; unused at inspection |
| Windows physical memory | 16,951,218,176 bytes (about 15.8 GiB) |
| Linux filesystem | ext filesystem, 1 TiB virtual disk; about 947 GiB free; 1% inode use |
| Physical volume backing this distribution | C:, 152,389,615,616 bytes free (about 142 GiB) |
| Cgroup root limits | memory.max=max; cpu.max=max 100000 |
| Network | wslinfo reports nat; port 8787 not listening |
| Service manager | system and user systemd running; user Linger=yes; no hub unit |

The distribution registration places its VHD on C:. The virtual free capacity is not a
physical storage guarantee. No destructive storage benchmark or high-load capacity test
was performed. These resources and the passing functional checks establish readiness for
an initial M1 hub launch, not a measured maximum session count or production availability.
No GPU or separate database server is required for the hub's Node/SQLite workload.

Node 24.22.1, pnpm 10.18.0, schema.sql and dashboard assets were rechecked. A fresh
`pnpm test:hub-smoke` again passed all nine checks on Linux and cleaned up. Prior build,
typecheck and 171 protocol/hub test results above are from the preceding inspection in the
same session, not rerun after documentation-only edits.

Remaining work is deployment configuration: protected shared key, persistent data directory,
hub unit/environment and Windows/WSL startup behavior. LAN access needs explicit NAT/network
setup and an external client test. No persistent service, secret or firewall was installed
by this inspection. Real two-session LAN/vendor and step 7 full-day acceptance remain open.

## Deployment configuration follow-up (2026-10-25)

The user authorized key/data setup and service/WSL autostart. Created a private hub.env
(0600) with a cryptographically random 256-bit key, persistent data directory (0700), and
SQLite database (0600). No key value is recorded in this repository. Created and enabled
user kommutator-hub.service with Restart=on-failure and UMask=0077; authenticated snapshot
returned 200 and an unauthenticated request returned 401. Explicit service restart passed.

Registered and started Windows task Kommutator-WSL-Hub under the current interactive user,
triggered at logon, running a long-lived WSL sleep command to keep Ubuntu-24.04 alive.
Observed task Running and service active/enabled. This supersedes the earlier missing-key,
missing-data and missing-service findings. Reboot/logon behavior has not been observed;
before-login startup, sleep policy, LAN access and live client acceptance remain unconfigured
or unverified. See the updated runbook for paths and management commands.
