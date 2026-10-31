---
title: Architecture and current implementation boundary
type: note
tags: [architecture, m1]
---

# Architecture and current implementation boundary

The four workspace packages implement CLI shim/hooks → host daemon → hub, with a shared
protocol package. Steps 1–5 have conformance, real-process and browser coverage; step 6
passed live two-Claude acceptance. See the [daemon/shim checkpoint](../sdlc/m1-daemon-shim/implementation.md)
and [M1 run](../../spikes/RESULTS.md#m1-run--production-two-session-acceptance).

| Component | Observed source and boundary |
| --- | --- |
| Protocol | [index.ts](../../packages/protocol/src/index.ts), [schemas.ts](../../packages/protocol/src/schemas.ts), [results.ts](../../packages/protocol/src/results.ts), [headers.ts](../../packages/protocol/src/headers.ts): records, wire validation, address/header utilities |
| Hub | [rpc.ts](../../packages/hub/src/rpc.ts): validated lifecycle, routing, resync, receipts, topics, versioned boards; [server.ts](../../packages/hub/src/server.ts): authenticated HTTP/WS and SSE |
| Harness | [testing.ts](../../packages/hub/src/testing.ts): production dispatcher against in-memory SQLite, fake host clients and explicit session binding; exported as @kommutator/hub/testing |
| Storage | [db.ts](../../packages/hub/src/db.ts), [schema.sql](../../packages/hub/schema.sql): SQLite schema/version checks and online backup |
| agentd | [core.ts](../../packages/agentd/src/core.ts), [registry.ts](../../packages/agentd/src/registry.ts), [daemon.ts](../../packages/agentd/src/daemon.ts): bound IPC, durable outbox/ledger, WS reconnect, native wake policy and lifecycle |
| CLI | [mcp.ts](../../packages/cli/src/mcp.ts), [hooks.ts](../../packages/cli/src/hooks.ts), [commands.ts](../../packages/cli/src/commands.ts): 14 SDK tools, bounded hooks, daemon/init/status/DND/send/hub commands |
| Dashboard | [index.html](../../packages/hub/public/index.html): live seven-event feed, sessions/deliveries, reconnect snapshot and bounded text rendering |

The [MVP plan](../MVP_PLAN.md) targets two Claude Code sessions on one Mac (M1).
The deployment target is a Docker hub in this WSL2 Ubuntu environment with WSL2/macOS clients; [the runbook](../WINDOWS_LAN_SETUP.md) distinguishes preparation from target
acceptance. Native Windows clients and full Codex product integration remain later work.
Step 7 diagnostics/logs/dashboard polish is implemented; day-long real use remains open.
Process tests do not establish live vendor acceptance. See [[vendor-evidence-gates]].

Follow-up, 2026-10-27: [[codex-root-identity]] records the M2 root metadata and hook
boundary; earlier Codex-deferred statements above describe the historical M1 baseline.
