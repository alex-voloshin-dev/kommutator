---
type: onboarding
feature: transfer-readiness
status: final
date: '2026-10-25'
components:
  - packages/protocol
  - packages/hub
  - packages/agentd
  - packages/cli
  - plugins/claude-code
  - scripts/smoke-hub.mjs
entry_points:
  - packages/cli/src/index.ts
  - packages/hub/src/index.ts
  - scripts/smoke-hub.mjs
conventions:
  - Source-only transfer, independent frozen installation and build on each OS
  - Windows hub uses TCP; Windows client runs Linux Node and Claude inside WSL2
  - Keys and runtime databases stay outside the copied source directory
  - English artifacts, shared AGENTS.md and CLAUDE.md import for coding agents
risks:
  - Native Windows client IPC, liveness and hook launching remain unsupported
  - Full Codex product integration remains deferred beyond M1
  - Windows/WSL target and actual LAN acceptance have not run on destination hardware
  - macOS live Claude evidence does not establish WSL native wake behavior
  - Full-day operability acceptance remains open
---

# Transfer readiness checkpoint

**Target correction, 2026-10-25:** the user confirmed that the hub runs in the current
WSL2 Ubuntu environment. Native Windows references below describe the superseded
preparation assumption, not a current requirement. See the [current runbook](../../WINDOWS_LAN_SETUP.md)
and [local readiness](../local-hub-readiness/onboarding.md). The associated audit.json is
a historical preparation record; its target is superseded.

Prepared on 2026-10-25 for a native Windows hub and a separate Windows machine running the
first Claude client in WSL2 Ubuntu. macOS clients can join later. The complete procedure is
[WINDOWS_LAN_SETUP.md](../../WINDOWS_LAN_SETUP.md); destination results belong in
[target-acceptance.md](target-acceptance.md), which remains **not run**.

## Folder audit and cleanup

The initial tree contained 81,794,399 bytes of regular files. Reproducible dependencies
accounted for 78,826,684 bytes, generated dist for 252,645, local pnpm cache for 8,192 and
the obsolete Docker ignore copy for 41. All 488 symlinks were inside dependencies. The
Mac install contained darwin-arm64 esbuild/Rollup binaries and must not be reused on Windows
or Linux. The cleanup removes these generated files from the source folder after validation.
See [audit.json](audit.json) for the final inventory and removed paths.

Source, tests, lockfile, hidden project/plugin configuration, hub SQL/dashboard assets,
all historical reviews and spike/acceptance evidence are preserved. The root project review
and docs review are different historical versions, not duplicate cache files. No runtime
socket, real config/key file, log or hub/client database was found outside the package
cache. A scan for common credential formats found no matches; this is a bounded check,
not proof against every possible secret encoding. Filename checks found no Windows reserved
names, case collisions or external symlinks in the transferable source.

Added `.pnpm-store` and Windows metadata ignores; strengthened the Docker context exclusions
for caches, local env files, databases and logs. `clean` in all four packages now uses Node
instead of Unix `rm`. Fixed stale M0 / future-doctor descriptions in CLAUDE.md and plugin
README, and refreshed current onboarding/status guidance. Agent setup remains AGENTS.md
plus CLAUDE.md's shared import; product integrations are configured on each destination.

## Verification from a fresh source copy

Created an isolated source-only copy in a path containing spaces. With Node **24.19.0** and
pnpm **10.18.0**, installed from the existing local pnpm store using a frozen lockfile:
179 packages reused, zero downloaded. The lockfile stayed byte-identical. Then ran:

```text
pnpm -r build                 passed
pnpm -r typecheck             passed
pnpm -r test                  295 passed (30 protocol / 141 hub / 49 agentd / 75 CLI)
pnpm test:hub-smoke           9 checks passed
pnpm clean                   passed; all four dist directories removed
```

The first install warned about hub bin entries pointing to not-yet-built dist and ignored
esbuild's install script. The subsequent build and tests passed with the locked platform
binary; no dependency scripts were enabled globally to suppress the warnings.

The new [smoke script](../../../scripts/smoke-hub.mjs) spawns real CLI hub/backup processes
with temporary credentials and DB paths containing spaces. It verifies HTTP authorization,
Basic-auth dashboard, snapshot, registration on two distinct WS hosts, send/deliver,
marked-read semantics, online backup, persistence after restart and backup restoration.
It is bounded, cleans its processes/temp directory and redacts its random key on errors.
A separate induced hub startup failure returned exit 1 with redacted diagnostics and clean
shutdown. No live vendor process was started for these checks.

All execution above occurred on **macOS**, including the isolated copy. Native Windows and
WSL2 were statically reviewed, not executed here. The local Docker engine was unavailable;
no Linux-container pass is claimed. Destination installation and live WSL Claude acceptance
remain explicitly required by the runbook.

## Platform findings and limits

Hub runtime uses Node HTTP/WS and built-in SQLite, with fileURLToPath/path joins for static
assets; the chosen hub path needs no Unix IPC. Windows tests should run the protocol/hub
suites and the TCP smoke. The WSL client must use Linux Node, pnpm, Claude and `ps` inside one
distribution, a Linux-home source copy, and a real executable kom symlink on its PATH.
Each daemon needs a unique host ID and private config/state. Project membership follows
normalized Git remote, then KOM_PROJECT, then cwd basename.

A native Windows client cannot be made ready solely by changing commands: IPC currently
uses filesystem chmod/unlink around named-pipe names; process birth identity uses Unix ps;
Claude liveness checks Unix socket metadata. The .cmd/exec-form issue is additional.
Full Codex registration/binding/lifecycle/native delivery is also unimplemented as a product
integration: current hook/shim vendor detection selects Claude or generic, not Codex.
These limitations do not affect using Codex to edit this repository through AGENTS.md.

Independent platform/folder audits and final runbook/script review approved the preparation.
Two minor documentation comments were addressed: create/read a real board test marker on a
fresh hub, and include the handoff and target acceptance template. No dependency versions,
wire schemas, authentication rules or runtime data changed. No Git initialization, license
selection, global agent configuration, publication or deployment occurred.
