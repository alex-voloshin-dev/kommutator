# Architecture and contributor map

Current map, 2026-11-14. [DESIGN](DESIGN.md) defines behavior and [PROTOCOL](PROTOCOL.md)
indexes the executable schemas; this guide is an entry point, not a replacement contract.

| Component | Code | Responsibility |
| --- | --- | --- |
| Protocol | `packages/protocol/src/` | Zod RPC records, identities, addressing, bounded headers and frames |
| Hub | `packages/hub/src/` | Authenticated HTTP/WS, SQLite routing/replay, topic boards and dashboard |
| Daemon | `packages/agentd/src/` | Per-host Unix IPC, pinned sessions, durable outbox, reconnect/resync and vendor adapters |
| CLI | `packages/cli/src/` | MCP stdio shim, hooks, configuration/setup, diagnostics and management |
| Integration | `plugins/` | Source templates; exporter creates standalone vendor plugins |
| Packaging | `scripts/export-plugins.mjs`, `docker/`, `compose.yaml` | Client runtime artifacts and isolated persistent hub |
| Evidence | `spikes/`, `docs/sdlc/` | Versioned observations and historical implementation handoffs |

The MCP shim/hook binds through `ipc.hello` to agentd. The daemon owns caller identity and
forwards RPC through one authenticated WebSocket to the hub. The hub derives authorship,
checks topic membership and commits sequence/replay/board-CAS state transactionally.
The read-only dashboard consumes an authenticated snapshot and event stream.

Negotiated unread recovery uses `deliveries.resync.page` and the shared coordinator
in `packages/agentd/src/resync.ts`. Fixed highwaters, encoded page bounds and indexed
lookups keep each recovery page bounded. Transient scan cursors do not mark messages
read. Hub schema 8 adds unread-range and target lookup indexes; old peers retain the
legacy recovery limitation. Exact authority/epoch checks also fence wake rearming.

MCP send/ack outcomes have a separate bounded local observation journal in
`packages/agentd/src/operations.ts`. It shares atomic admission/settlement with the outbox
but supplies no replay authority. `operation_status` checks the current pinned owner;
a pure runtime probe and bounded IPC lookup lane avoid triggering or awaiting an earlier
mutation on an already bound connection. See DESIGN §19 for retention and crash limits.

Claude identity uses observed vendor session facts; native wake depends on supported
per-session policy and socket metadata. Codex independent roots use call-level
`_meta.sessionId`/`threadId`, with shim-owned liveness and hook-time delivery; forks cannot
create separate MCP mailboxes. Generic delivery is pull-only. See [capability matrix](../README.md).

The GitHub marketplace installs a checksum-pinned complete Claude ZIP through its native
installer. Codex uses a lightweight launcher that downloads a source-pinned archive on first
MCP start; hooks only use an existing cache.
The bundled plugin has private browser setup and copies its runtime outside the vendor
cache. Both clients share private configuration and daemon state. Source/manual integration
requires Node and `kom` in the actual client launch PATH; bundled plugins carry Node.
See [installation](INSTALL.md) and [artifact build](PLUGIN_BUILD.md).

Implemented work includes M1 hub/daemon/shim/hooks/dashboard, live Claude M1 acceptance,
operability tools, M2 Codex hook mode, opt-in subnet ingress and local plugin distribution.
Open acceptance is tracked in [ROADMAP](ROADMAP.md). The old
[scaffold onboarding](sdlc/repo-onboarding/onboarding.md) and [MVP_PLAN](MVP_PLAN.md)
retain historical snapshots. [Knowledge notes](knowledge/MOC.md) preserve decision rationale.

Optional host-side feedback triage and autonomous maintenance are described in
[the maintainer runbook](FEEDBACK_MAINTAINER.md); neither is a client installation prerequisite.

A separately authorized [local release updater](LOCAL_RELEASE_DEPLOY.md) can apply qualified
releases to an existing default hub and agentd; it remains opt-in operator infrastructure.
