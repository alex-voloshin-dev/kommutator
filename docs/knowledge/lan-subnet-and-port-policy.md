---
title: Single-subnet LAN access and stable hub port
type: note
tags: [deployment, security, decision]
---

# Single-subnet LAN access and stable hub port

> Public evidence redaction: personal home paths, interface names and network addresses
> are replaced with placeholders (192.0.2.0/24 and 198.51.100.0/24 are documentation ranges).
> They are not deployment instructions or measured endpoint values. Original records are retained privately.

The user required remote LAN access to be limited to machines in one local subnet on
2026-10-27 until fuller security is developed. TCP 8787 is the stable default published
and container port for HTTP/dashboard/SSE/WebSocket across restarts and redeployments.
Explicit overrides for tests or special deployments remain possible; no automatic fallback
port is authorized.

When LAN is enabled, determine the selected physical interface's real address/prefix and
record a single explicit allowed CIDR. Do not infer /24 or allow all private networks, all
interfaces, VPN clients or the internet. Enforce the remote-source restriction at ingress
before Windows/WSL forwarding and cover alternate exposure paths, including IPv6. Local
loopback remains available; KOM_KEY stays mandatory for every client. Encryption alone
does not authorize widening the allowed network.

This decision is recorded in [DESIGN section 12](../DESIGN.md#12-security), section 19,
[AGENTS](../../AGENTS.md), README, PROTOCOL and [the runbook](../WINDOWS_LAN_SETUP.md).
[compose.yaml](../../compose.yaml) already defaults to loopback TCP 8787; it was not changed.
No LAN firewall/forwarding was configured by this documentation task. Verify permitted and
denied source networks when implementing LAN access; keep missing negative tests unverified.
See [[docker-hub-isolation]] and [[hub-deployment-requirements]].

Implementation: [Windows LAN helper](../../scripts/configure-lan.ps1) keeps Docker
loopback-only and checks effective source-scoped firewall rules before opening a Windows
IPv4 proxy to localhost. Plan verified the actual 192.0.2.10/24 interface. Apply requires
elevation and has not run; external LAN acceptance remains open. Revalidate changed
interfaces/topology; this helper is not a continuous firewall watchdog.

Follow-up: corrected Apply is now installed at Windows 192.0.2.10:8787 for
192.0.2.0/24. Actual effective-rule and local HTTP/WS authentication checks passed;
Docker remains loopback-only. A separate machine is unavailable, so external allowed/denied
acceptance remains open. WSL source is translated to the Windows LAN address and cannot
serve as that negative test. See [installed validation](../sdlc/m2-lan/installed-validation.md).
