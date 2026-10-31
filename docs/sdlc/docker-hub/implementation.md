# Docker hub deployment checkpoint

Status: implemented, reviewed and running on 2026-10-25. The user required Docker isolation
and replacement of the temporary native hub service. The server, HTTP/WS dashboard and SQLite
runtime now run in one container in this WSL distribution. Client/vendor processes stay on
their own hosts. LAN and real reboot acceptance remain separate.

## Scope and decisions

The direct user request was the implementation plan. No upstream feature plan was required.
Assumptions: retain loopback publication until LAN setup, retain the existing key/database,
keep Windows logon startup (not before-login startup), and use existing Docker Engine.
The repo is a source transfer without Git; the implementation ran in an isolated temporary
source snapshot, followed by scoped integration. No Git initialization/commit was performed.
Source detection returned a root JavaScript package profile; the app remains TypeScript,
and repository pnpm build/typecheck/test commands were used rather than npm fallbacks.

Changed runtime files: compose.yaml, docker/Dockerfile, Dockerfile.dockerignore, start.mjs,
secret.mjs, healthcheck.mjs, backup.mjs and smoke.mjs. No application source, wire contract,
schema or dependency-lock changes. Updated AGENTS, README, DESIGN section 19, MVP plan,
operations/deployment documentation and linked knowledge notes to record the chosen runtime.

Compose runs UID/GID 1000, a read-only rootfs, dropped capabilities and no-new-privileges,
with bounded PID count, tmpfs and logs. Host loopback 8787 publishes the container port.
A file secret is mounted read-only, not injected into image/config environment/arguments.
The bootstrap reads the key and invokes existing hub APIs, with graceful shutdown.
Only the private data directory is a writable persistent host mount. No Docker socket,
source checkout or vendor token/socket mounts are exposed to the container.

## Migration and current state

- Disabled/stopped native kommutator-hub.service and the Windows keepalive task before work.
- Preserved the generated key in ~/.config/kommutator-hub/hub.key (0600).
- Preserved ~/.local/share/kommutator-hub/kommutator.db (0600), parent 0700.
- Created a VACUUM INTO pre-docker backup under ~/.local/share/kommutator-hub-backups/,
  mode 0600, outside the container's data mount.
- Archived the retired native unit and hub.env under ~/.config/kommutator-hub/retired-native/;
  the unit is now not-found/inactive after daemon-reload. Do not restore it alongside Docker.
- Built image kommutator-hub:local and launched service hub as kommutator-hub-1.
- Observed container healthy, authenticated snapshot 200, unauthenticated snapshot 401.
- Inspected actual UID, read-only rootfs, capability/security settings, original data mount,
  read-only secret, unless-stopped policy and absence of the key value in inspect/logs.
- At one idle sample the container used about 23 MiB RAM and 0.01% CPU; not a capacity test.
- Docker Engine is enabled/active. Updated the Windows task description to the Docker startup
  chain, re-enabled it and observed Running. It keeps WSL alive at user logon; Docker restores
  the container. Windows reboot/logon has not actually been exercised.

Observed image ID: sha256:a1a911e675c359ff5e6301c8e3b02461b09388595fdddb279164f6cb97192502.
The local image tag can change on future rebuilds; this is evidence for this run only.

## Validation

- All four workspace builds and typechecks passed; all 295 tests passed (30 protocol,
  141 hub, 49 agentd, 75 CLI).
- Docker Compose configuration and Node syntax checks passed.
- The image built from the integrated repository using frozen pnpm 10.18.0, production
  deploy and an in-image schema/dashboard/WS construction smoke. Known missing prebuild bin,
  ignored esbuild script and legacy deploy warnings did not prevent the successful build.
- Independent correctness/integration and security reviews approved. Final QA test amendment
  was also approved. See [review](review-code-1.md).
- Optional configured external-review helper returned no usable result; skipped, not a pass.
- Parent ran the initial integrated 16-case Docker smoke successfully. Delegated QA added
  real write-denial and crash-restart cases and ran the final 18-case smoke successfully.
  All checks: isolation configuration, runtime write isolation, secret mount, authenticated
  health, published HTTP auth, dashboard, two-host registration, send/deliver, marked read,
  online backup, backup overwrite refusal, recreate persistence, graceful stop, backup
  restore, absent key in inspect/logs, unexpected-exit restart, missing secret rejection,
  short secret rejection.
- Two QA harness defects were observed and corrected: nested-template regex escaping and
  the expected docker exec exit 137 when tini exits after app SIGKILL. No runtime defect was
  masked: RestartCount growth, healthy recovery and persisted message remained required.
- Disposable test containers/data/keys were cleaned. Production verification was read-only
  HTTP/inspection after deployment; no fabricated client history was added to the real DB.

The develop review loop resolved to proceed after approve and green QA. Temporary source
snapshot was removed after integration. Project guidance and vault links were validated.

## Remaining acceptance

**Follow-up, 2026-10-27:** [three real local WSL agents](../wsl-live-load/implementation.md)
passed native wake, concurrent messaging, board and client-exit checks. This supersedes
the unverified local WSL vendor-wake item below; remote LAN and reboot remain open.

Remote LAN access/NAT/firewall, actual reboot/logon behavior, live WSL Claude native wake,
and the full-day operability gate remain unverified. Before-login startup is not configured.
No Windows sleep-policy change was made. Use [the runbook](../../WINDOWS_LAN_SETUP.md) for
operation, backup, secret/data paths and the Windows/WSL/Docker startup boundary.
