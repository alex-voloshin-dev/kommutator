---
title: "Hub deployment requirements"
type: note
tags: ["hub", "operations"]
---

# Hub deployment requirements

The hub runs independently of client agentd, Claude, MCP and hooks. The selected deployment
is Docker Compose in WSL (`compose.yaml`), with key and SQLite data outside the image.
`node packages/cli/dist/index.js hub run` remains a development entrypoint; it requires `KOM_KEY` (at least 16 characters), with optional `KOM_HUB_BIND`, `KOM_HUB_PORT` and `KOM_HUB_DB`. Defaults are loopback, 8787 and a cwd-relative database. Set an explicit persistent database path with an existing writable parent for deployment.

Node 26.13.0 includes SQLite; no separate database service is needed. Preserve schema.sql and public/index.html alongside the built hub. Run a single hub process per database because pub/sub is in memory. Use the Docker Compose hub path in INSTALL; client agentd supervision is distinct from hub supervision.

Sources: [CLI](../../packages/cli/src/commands.ts), [database](../../packages/hub/src/db.ts), [server](../../packages/hub/src/server.ts), [design](../DESIGN.md#11-storage), [deployment runbook](../WINDOWS_LAN_SETUP.md). See [[architecture-map]] and [[operability-evidence]]. Machine-specific observations are in [hub readiness](../sdlc/local-hub-readiness/onboarding.md).

See [[docker-hub-isolation]] for the current runtime boundary and startup chain.
