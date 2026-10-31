---
title: Hub storage and authentication
type: note
tags: [hub, storage, security]
---

# Hub storage and authentication

[hub/index.ts](../../packages/hub/src/index.ts) requires KOM_KEY of at least 16
characters, binds 127.0.0.1:8787 by default, and opens the configured SQLite file.
[server.ts](../../packages/hub/src/server.ts) authenticates HTTP with Bearer or Basic;
WS requires explicit Bearer to prevent cross-origin browser use of cached Basic credentials.
It contains malformed-frame/handler failures per connection. Authenticated snapshot and
SSE are implemented; SSE reconnects require a fresh snapshot, not replay of an event log.

[db.ts](../../packages/hub/src/db.ts) uses node:sqlite, stamps SCHEMA_VERSION = 5 on a
fresh database and refuses a different existing schema. [schema.sql](../../packages/hub/schema.sql)
initializes WAL/foreign keys and defines hosts, sessions, topics, memberships, messages,
targets, deliveries and versioned boards. Foreign keys are enabled on every reopen.
A registration journal retains historical replay results; requested_name stabilizes
collision suffixes; message handles and board session ownership preserve history on rename.
A partial unique index protects live handles;
deliveries are unique by message/recipient and recipient/seq.

backupDatabase uses VACUUM INTO. A plain copy of a live WAL database is not the project's
backup procedure. Schema shape changes require a version bump; there is no migration
runner. Prune is a CLI stub and must remain disabled under the current plan.

The [Dockerfile](../../docker/Dockerfile) builds from the root context, deploys the hub
with pnpm deploy --legacy, and binds 0.0.0.0 inside the container. The current
[Compose deployment](../../compose.yaml) publishes host loopback, mounts a file secret and
persistent data, and runs non-root with a read-only rootfs. The historical onboarding only
inspected Docker; see [[docker-hub-isolation]] for subsequent build/runtime evidence.
The [hub suite](../../packages/hub/test/server.test.ts) covers transport/auth and storage;
[restart tests](../../packages/hub/test/invariants.test.ts) verify persistence across open/close.
Separate handler, conformance and transport suites exercise lifecycle, routing, replay and CAS.
