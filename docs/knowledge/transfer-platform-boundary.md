---
title: WSL hub and client platform boundary
type: note
tags: [deployment, platforms, operations]
---

# WSL hub and client platform boundary

The user explicitly corrected the deployment target on 2026-10-25: the hub will run
in Docker inside the current WSL2 Ubuntu environment, with dashboard and SQLite runtime
in the same container. Native Windows hub installation is not required. The later explicit
isolation request supersedes the temporary native systemd hub deployment.
The earlier claim that the user chose a native Windows hub was an incorrect assumption.
This decision is reflected in AGENTS.md, DESIGN section 19, MVP_PLAN.md, README.md and
[the deployment runbook](../WINDOWS_LAN_SETUP.md) (filename retained for link compatibility).
See [[hub-deployment-requirements]] and [[architecture-map]].

Transfer sources with hidden plugin assets, SQL, public dashboard and lockfile. Install
and build independently on each OS; never carry Mac node_modules or client private state
across machines. Each daemon has a unique host ID. Project identity prefers normalized
Git remote over KOM_PROJECT, then cwd basename; inspect actual whoami rather than assuming.

The hub path uses TCP and portable Node APIs. Native Windows clients still require changes
to IPC named-pipe filesystem handling, process birth identity and exec-form hook launching.
The current Claude socket probe is also Unix-specific. Full Codex product integration is
separate from repository onboarding for Codex and remains deferred. The [TCP smoke](../../scripts/smoke-hub.mjs)
checks hub messaging, auth and persistence, not live vendor behavior or the full-day gate.

Follow-up, 2026-10-27: [[codex-root-identity]] records the M2 root metadata and hook
boundary; earlier Codex-deferred statements above describe the historical M1 baseline.
