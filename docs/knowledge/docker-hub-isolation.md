---
title: Docker hub isolation and startup
type: note
tags: [hub, docker, operations]
---

# Docker hub isolation and startup

The user required container isolation on 2026-10-25 after a temporary native hub setup.
Run the complete hub server/dashboard/SQLite runtime through [compose.yaml](../../compose.yaml)
in the current WSL distribution. Client agentd, MCP/hooks and Claude remain on client hosts.
The native hub systemd service is retired; Docker Engine is host infrastructure.

The container runs as non-root with a read-only root filesystem, no capabilities and
no-new-privileges. Only /data and bounded /tmp are writable. A separate host key file is
mounted read-only; its value is not passed as container environment or command arguments.
Keep the existing host database/key; make a VACUUM INTO backup before switching runtimes.
Compose publishes WSL loopback by default; no remote LAN reachability is implied.

Windows user logon starts/keeps WSL alive, WSL systemd starts Docker Engine, and Docker's
unless-stopped policy restores the hub container. Explicitly stopped containers remain
stopped. Before-login operation and real reboot acceptance are not established.

See [the runbook](../WINDOWS_LAN_SETUP.md), [implementation evidence](../sdlc/docker-hub/implementation.md),
[[hub-deployment-requirements]], [[hub-storage-and-auth]] and [[transfer-platform-boundary]].
