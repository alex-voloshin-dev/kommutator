# Docker hub in WSL2 and single-subnet LAN access

For a fresh hub and client configuration, start with [INSTALL](INSTALL.md). This guide
covers the optional Windows ingress layer after loopback Docker access works. Native Windows
clients remain unsupported; run client processes entirely inside WSL2 or use qualified source
clients on macOS. Do not run two hub processes against one database.

Keep Compose published on `127.0.0.1:8787`. The Windows helper forwards a selected physical
LAN IPv4 address on TCP 8787 to Windows loopback, which WSL localhost forwarding maps to
Docker. Firewall source restrictions apply before the proxy hides the original source.
The shared key remains mandatory, and HTTP/WS is unencrypted. This is one shared trust domain,
not isolation between mutually untrusted users. Do not widen access to VPNs or the internet.

Inspect the physical interface's actual address and prefix. Choose its single explicit CIDR;
never infer `/24` or allow all private ranges. In Windows PowerShell, first run the read-only
plan (replace both placeholders; use the repository's Windows/WSL UNC path if needed):

```powershell
.\scripts\configure-lan.ps1 -Mode Plan -InterfaceAlias '<physical interface>' -ExpectedSubnet '<actual CIDR>'
# Review the plan, then use elevated PowerShell:
.\scripts\configure-lan.ps1 -Mode Apply -InterfaceAlias '<physical interface>' -ExpectedSubnet '<actual CIDR>'
# Remove only this helper's owned ingress:
.\scripts\configure-lan.ps1 -Mode Remove
```

The helper validates address/prefix drift, enabled firewall profiles, proxy ownership and
conflicting listeners. It validates provider rules with WhatIf before mutation and blocks
IPv4 sources outside the CIDR before enabling forwarding. Do not publish an alternate IPv6
listener without equivalent restrictions. Review overlapping rules and all exposure paths.
Re-run Plan after interface, subnet, firewall or WSL changes; remove stale settings before
applying a new subnet. There is no continuous topology watchdog.

Test from a separate allowed-subnet machine: authenticated HTTP and WS work, and missing/wrong
keys fail. Test from a separate outside-subnet machine: it cannot reach the listener even
with the right key. Host-local tests do not establish this boundary. WSL source NAT can make
an apparent outside source arrive as host-local traffic; it is not a valid negative test.

The historical installation passed Apply, effective-rule checks and host-local HTTP/WS
authentication. No separate physical client was available, so external allowed/denied-subnet
acceptance remains open. Personal endpoints are redacted in public evidence. See
[installed validation](sdlc/m2-lan/installed-validation.md).

Docker's `restart: unless-stopped` restarts an existing container with the engine unless
intentionally stopped. WSL/Docker startup at Windows login is separate host configuration;
no boot task is installed by these instructions. Systemd services alone do not keep WSL alive.
Actual reboot/logon acceptance and before-login availability are not established.
For backup and restore, follow [INSTALL](INSTALL.md#3-operations).
