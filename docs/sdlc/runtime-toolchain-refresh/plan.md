---
type: plan
feature: runtime-toolchain-refresh
status: approved
tasks:
  - id: R0
    deps: []
    title: Accept dependency phases 1 through 3
  - id: R1
    deps: [R0]
    title: Inventory and qualify isolated toolchain candidates
  - id: R2
    deps: [R1]
    title: Migrate the complete repository runtime contract
  - id: R3
    deps: [R2]
    title: Qualify isolated artifacts and deployment rehearsal
  - id: R4
    deps: [R3]
    title: Prepare and publish one qualified release
  - id: R5
    deps: [R4]
    title: Update authorized local services and verify actual runtime
  - id: R6
    deps: [R5]
    title: Report deployment and preserve outstanding acceptance
checkpoints:
  - "C0: Exact phases 1–3 revision accepted with build, typecheck, test and release qualification green."
  - "C1: Signed upstream runtime checksums, package-manager installation method and isolated migration evidence recorded."
  - "C2: Package manifests, lockfile, CI, Docker, exporter, bootstrap and updater agree on the qualified toolchain."
  - "C3: Fresh Linux x64 qualification and isolated non-root Docker and updater rehearsal pass without production access."
  - "C4: Exact published commit has successful latest Release checks and Secret scan; assets and catalogs match recorded hashes."
  - "C5: Actual local hub and agentd run the expected release and Node runtime, connected and healthy after restart."
  - "C6: User and kommutator-feedback receive observed results and remaining gates."
deferred:
  - "Implementation of phase 4 during the dependency phases 1–3 work."
  - "Automatic rollback, schema downgrade, pruning, identity or receipt changes."
  - "New operating-system support, public vendor marketplace approval and GHCR publication."
  - "Closing physical LAN, reboot/logon, day-long usage, Work desktop or idle-native-wake gates without new observations."
  - "Unrelated dependency updates and optional CI action-major modernization, which can ship separately."
---

# Runtime and package-manager refresh, phase 4

Plan date: 2026-11-11. This is a separate follow-up to the approved dependency refresh.
The requested targets are Node **26.13.0 LTS**, pnpm **12.18.0**, and a verified exact
`@types/node` 26.x release. No `tech-design.md` or `prd.md` exists for this feature;
the approved request and repository contracts are the design inputs. The assumption is
that runtime replacement preserves the existing product behavior, supported Linux x64
release surface, schemas and runtime contract. Any incompatible recovery change must first
be documented in DESIGN §19 and reflected in PROTOCOL and executable schemas.

This plan defines future work; it is not execution evidence or authorization to perform
phase 4 now. Each checkpoint requires the observations specified below.
The user explicitly extended the review budget to six rounds for this plan only; this
exception does not authorize phase-4 implementation or change other workflow review limits.

Inputs read: ARCHITECTURE, ROADMAP, DESIGN §§3–8, 11–14 and relevant §19 deployment,
identity and plugin decisions; PROTOCOL caller identity; MVP_PLAN non-negotiables;
LOCAL_RELEASE_DEPLOY; knowledge notes for toolchain, vendor evidence and the local
feedback mandate. Current code surfaces include `docker/Dockerfile`,
`.github/workflows/release-check.yml`, `scripts/export-plugins.mjs`,
`scripts/package-client-release.mjs`, `plugins/runtime/bootstrap.mjs`,
`scripts/release-check.mjs`, and `scripts/{local-release-deploy,lib/local-release-deploy}.mjs`.
Re-read these at R0 because phases 1–3 are being implemented independently.

## Sequence and task acceptance

The mandatory DAG is R0 → R1 → R2 → R3 → R4 → R5 → R6 for the successful path. Any publication or
deployment failure also has an unconditional terminal reporting action inside R4/R5;
that action does not depend on reaching R6 and never marks C5 successful. Keep phase 4 in its own
branch/PR after accepting phases 1–3. R2 is one synchronized runtime cutover: do not ship
an intermediate release whose package-manager pin, runtime exporter and updater disagree.
Each task produces a separately reviewable result; only R4 publishes product artifacts.

### R0 — Accept the prior dependency work

Require the accepted revision to contain phase 1 (`ws` 8.22.2 and pnpm 10.34.9), phase 2
(`citty` 0.2.2 and Vitest 5.1.0), and phase 3 (TypeScript 7.0.2 with the agreed TS6
compatibility path). Record actual versions and the accepted commit, rather than assuming
ongoing work has landed. Do not silently reopen or replace its compatibility decisions.

Checkpoint C0 requires successful `pnpm install --frozen-lockfile`, `pnpm -r build`,
`pnpm -r typecheck`, `pnpm -r test` in that order, and `pnpm release:check` on its retained
Node 24/pnpm 10 baseline. Preserve logs and the original lockfile in the accepted revision.
Any outstanding failure blocks phase-4 implementation; dependency changes must not be
hidden in a runtime migration diff. Capture baseline artifact identity, process startup and
hook timing for later comparison without modifying live services.

### R1 — Establish a reproducible isolated migration path

Inventory every active Node/pnpm constraint with `rg`, including `.nvmrc`, engines,
packageManager, package build targets, `@types/node`, workspace settings, lockfile,
CI, Docker stages, source launcher requirements, export metadata, release guards, tests,
local-updater service/PATH and contributor/install/build documentation. Preserve dated
historical evidence; update only current instructions in R2.

Verify Node 26.13.0 from its official signed SHASUMS, retain upstream licenses, and inspect
Linux x64 dynamic-library requirements (including libatomic), glibc versus musl and Docker
image architecture. A working host binary does not qualify an Alpine image or another OS.
Verify an exact 26.x types package; do not infer its patch from Node's patch number.

Corepack is not bundled with Node >=25. Select and pin a verified supported installation
method for pnpm 12.18.0 in isolated CI/container/local-updater environments. If choosing
Corepack, install and validate an explicit compatible Corepack version before enabling it;
`corepack enable` alone is not a complete bootstrap. Verify the actual executable and
version under the updater's systemd environment and absolute Node path. Retain the current
working launcher until the transition is qualified; avoid global package-manager changes.

Review both intervening pnpm major migrations, installation support and the 12.18.0 release.
pnpm 11 moves general settings from `.npmrc` and changes build-script approval settings;
review the exact pnpm 12 equivalents before translating configuration. Use separate stores,
fresh output directories and private scratch homes. Check fresh and warm frozen installs,
workspace links, lifecycle approvals, optional binaries and TS7/TS6 tooling. Do not bypass
release-age policy, allow arbitrary builds, ignore integrity checks, or install agent skills
to make the toolchain pass. Missing approval/configuration becomes an explicit reviewed
configuration change. Record actual lockfile migration and deterministic second install.

Docker currently uses `pnpm deploy --legacy --prod`. pnpm 12 documentation retains legacy
mode and describes a newer non-injected workspace deployment path. First test the existing
mode against the exact target version; change it only with an independently verified
self-contained production deployment (workspace protocol package, runtime dependencies,
licenses and no dev dependency leakage). Do not assume injected workspaces are required.

Checkpoint C1 is a migration matrix containing exact versions/checksums, bootstrap method,
config/lockfile changes, deploy choice and isolated compatibility results. If a target cannot
be verified or a behavioral change is required, stop at that gap rather than substituting
an unqualified newer version. No live data is accessed by this task.

### R2 — Apply the synchronized runtime change

Update package/engine/toolchain declarations and matching Node types, lockfile and necessary
workspace configuration; TS7 and its TS6 compatibility path remain functional. Align build
targets and preserve ESM `.js` imports, strict flags and `removeNodeProtocol: false`.
Keep `node:sqlite` builtin. Exercise SQLite opens, transactions, backup and WAL behavior.

Update both Docker stages to the qualified Node 26.13.0 image (record its immutable digest),
pnpm bootstrap and verified deploy command. Preserve non-root ownership, secret mounts,
loopback host publication, isolated data volume and authenticated health checks.
Update CI to use the exact qualified Node and pnpm installation method. Keep workflow names
and exact-commit success semantics compatible with the updater. Audit the current
`actions/checkout@v4` and `actions/setup-node@v4` independently against official releases
and runner requirements; an optional action-major update belongs in a separate CI-only
change unless a demonstrated prerequisite makes it necessary. Its embedded action runtime
is distinct from the application Node version. Do not broaden token permissions.

Update exporter runtime/version and esbuild target guards, bundled runtime descriptions,
release checks and tests, packager verification, bootstrap and cache validation assumptions.
Use a new artifact version and runtime hash computed from the complete new payload. Preserve
SHA256 verification, source-pinned downloads, exact-hash vendor trust and offline hook
behavior. Reject corrupted payloads and mixed old/new binaries or metadata; do not reuse
an old cache directory under a new payload identity. Never edit generated `dist/` manually.

Update local-updater Node guard, packageManager equality and tests together. Explicitly
model the old updater → new toolchain transition: its Node24/pnpm10 checks currently reject
the new release. Prepare the trusted updater entrypoint and its private systemd runtime
prerequisites before the future activation; do not weaken checks to accept arbitrary pins.
For this coordinated cutover, add a constrained updater invocation that requires both the
expected release version and expected source commit. Resolve and verify that exact published
candidate and its downloaded assets; never substitute the ordinary highest-published-release
selection. Missing constraints, a different version/commit, a moved tag or mismatched artifact
identity must fail closed before any service, database or deployment activation mutation.
Preserve ordinary timer selection behavior outside this explicitly constrained cutover path.
Validate both the source release identity and the actual Node/pnpm executables used. Keep
exact-commit CI checks, complete Linux assets, downgrade protection, blocked interruption
state, private logs and no automatic retry/rollback. Any new recovery contract requires a
DESIGN §19 entry before implementation.

Before handing the candidate to R3, prepare its local release metadata in the order documented
in DISTRIBUTION and PLUGIN_BUILD: bump the product version, run `pnpm version:sync`, frozen
install, build/typecheck/test, export a fresh payload, verify that export, then run
`scripts/package-client-release.mjs` against fresh export/output directories. This creates the
versioned archives/checksums and regenerates the tracked hosted launcher and root catalogs
with their exact hashes. Keep all of these local and unpublished. This preparation must
precede `pnpm release:check`, whose catalog/version checks execute before its internal export;
otherwise a new product version with old catalogs fails qualification.

Checkpoint C2 requires consistent active pins and regenerated local release catalogs,
retained candidate archives/checksums, frozen install and ordered build/typecheck/test
results, plus focused exporter, corrupted-hash/cache, unsupported-runtime and updater failure
behavior tests. Change current AGENTS/CONTRIBUTING/INSTALL/PLUGIN_BUILD/LOCAL_RELEASE_DEPLOY,
DESIGN runtime descriptions and knowledge instructions together where applicable. Historical
versioned observations must remain historical. No tests solely for prose edits.

### R3 — Qualify artifacts and rehearse deployment in isolation

After R2's local version sync/export/package/catalog preparation, freeze the exact candidate
source commit and retained release archives/checksums. On a fresh Linux x64 checkout with
Node 26.13.0/pnpm 12.18.0 and no prior `dist/` or export cache, first run
`pnpm install --frozen-lockfile`, then `pnpm -r build`, `pnpm -r typecheck`,
`pnpm -r test`, and `pnpm release:check` in that order.
Preserve audit/secret checks. Verify the retained publishable archives themselves against
that candidate commit, regenerated catalogs and recorded hashes; release:check's temporary
export does not replace or qualify an unrelated retained archive. Any source, release metadata,
catalog or archive change invalidates the freeze and returns to R2 preparation and R3
qualification. Also run the updater tests and actual Docker build with fresh
outputs; release:check alone does not prove Docker deployment. Verify non-root startup,
authenticated health, database persistence, backup and restart using synthetic keys and
isolated volumes/ports. Exercise daemon survival, reconnect/resync and durable outbox replay.

Run exported-plugin verification, smoke and process E2E with bundled Node, including a cold
cache, valid warm cache, corrupted payload rejection and hook failures. Check hook empty
stdout/exit 0 and 200 ms budget, MCP protocol-only stdout and stderr diagnostics. Explicitly
exercise per-call Codex root identity and fork rejection; never inherit an environment ID
or substitute cwd. Receipt tests must distinguish shown headers/served bodies/explicit ack
from socket write/close. Preserve DND, FYI, hop limits and one trailing cooldown wake.

Rehearse old-runtime → new-runtime and interrupted-updater transitions with disposable
services and a snapshot copy. Include the release-publication/polling race: stopping a timer
while a oneshot holds the lock, draining that invocation, preserving blocked checkpoints,
and preventing new invocations through runtime replacement and activation. Add regression
cases where a newer unrelated release appears, release selection substitutes another version,
the expected version or commit is missing, and the tag/source commit mismatches. Prove the
constrained cutover either uses exactly its qualified candidate or fails before deployment
mutations; also verify ordinary timer behavior remains intact. Obtain SQLite snapshots using `VACUUM INTO`, not raw copies
of an active WAL database. Keep pristine snapshots read-only and test only separate working
copies. Show that failed preflight cannot stop services and failed activation remains blocked.
Retain old images/clones/runtime paths; rehearse manual recovery without assuming older
SQLite/runtime/schema compatibility. Never automatically restore a stale backup over newer
messages. Rollback requires operator reconciliation and an explicit data-preservation plan.

Checkpoint C3 requires logs tied to commit, OS/architecture, Node, pnpm, artifact hash and
Docker digest; regression review; and all required synthetic and container checks green.
Record observed results in `spikes/RESULTS.md` during implementation. Store qualification
and post-publication evidence in separate evidence-only commits referencing the immutable
release commit and artifact hashes. These commits must not move the release tag, modify
the frozen candidate or rebuild its archives. Synthetic clients prove
protocol/process behavior; they do not qualify live vendor wake or physical subnet access.

### R4 — Publish only the qualified release

Before publishing a discoverable release, verify the existing explicit authorization for
local updater maintenance and inspect its private checkpoint. Quiesce the live timer, then
drain or safely complete any already-running oneshot; stopping the timer alone does not
stop an active updater. Verify service inactivity and the updater lock is free before
proceeding. Preserve every checkpoint and retained attempt. If it is blocked or interrupted,
inspect actual services and backups and explicitly reconcile under the existing recovery
contract; do not clear state to manufacture a clean preflight. Until reconciled, publication
and deployment for this cutover remain blocked. Rehearse this publication/polling race in
R3 with isolated services. This live quiescence begins only here, after C3.

Keep the updater quiescent through publication, trusted entrypoint/runtime replacement and
R5 activation/verification. Record who owns the cutover and prevent competing updater
invocations during that interval. If publication fails, preserve the quiescent/checkpoint
state, report the failure immediately to the user and `kommutator-feedback`, and explicitly reconcile whether restarting the old
timer is safe; do not silently resume it against a partially published release.

Publish the already-prepared, frozen R2/R3 candidate without another version bump, catalog
regeneration or archive rebuild. Reconfirm its exact source revision and recorded checksums.
If any candidate input or output changes, return to R2 preparation and R3 qualification before
publishing; R4 is not a metadata-preparation step. Require successful latest
Release checks and Secret scan for the exact release commit before treating it as deployable.
Reconcile tag, source version, built protocol release version, tarball, Claude ZIP, checksum
files, runtime payload ID and hosted catalogs. Publish the exact tested complete archives
before catalogs that reference them; independently verify fetched bytes. Do not combine an
old Node24 export with Node26 metadata, reuse an unrelated artifact, or claim publication
from local packaging. Checkpoint C4 includes hosted release URLs, commit and asset hashes.
After publication, follow DISTRIBUTION's actual vendor installation check: anonymously
fetch the published assets and verify checksums, then install both plugins through the real
Claude and Codex CLIs in separate clean private homes. Check MCP startup and setup through
each installed plugin and record the release/hash, OS, Node, vendor CLI versions and observed
results in versioned evidence. Use disposable configuration and synthetic credentials; do
not change global inbound policy or infer identity from inherited environment variables.
If a vendor environment is unavailable, explicitly record its installation/startup/setup
acceptance as outstanding in the release evidence and terminal report; synthetic E2E must
not stand in for it. Observed install failures require investigation and correction under a
new version rather than silently replacing published bytes. Local hub/daemon deployment
evidence and vendor installation evidence remain separate claims.

Publication follows the user's standing release mandate; this plan run publishes nothing.

### R5 — Apply to authorized local hub and daemon

After C4, verify the existing explicit local deployment policy, private credentials/config,
default Compose topology, actual running versions and clean updater checkpoint. Install the
already-qualified updater runtime prerequisites in its intended private location and verify
service PATH/absolute Node selection. Reconfirm R4's quiescence, service inactivity and lock state before entrypoint
reconciliation; do not restart a timer or erase a blocked checkpoint to proceed. Record the
current hub image digest, daemon executable/runtime path and PID, source commit and runtime
contract without printing secrets. No plugin install is needed to inspect this repository.

Invoke R2's constrained cutover path with the exact qualified version and commit recorded
at R3/R4; do not invoke an unconstrained highest-release update for this operation. Reconfirm
candidate identity and hashes before the updater can mutate deployment state, and fail closed
if the invocation omits either constraint or resolves a different candidate.
Use the updater's authenticated preflight, image smoke and `VACUUM INTO` snapshots of hub
and agentd before activation. Preserve permissions and pristine backups. Activate the exact
qualified hub image and restart the shared daemon from its retained clone. A plugin version
change alone does not update an existing daemon. Observe actual hub container release and
Node version, daemon process executable/Node version, source release/runtime contract,
authenticated health, connection and persistence after restart; don't infer them from a
manifest or source checkout. Re-enable the timer only after successful verification or
explicit failure reconciliation. Keep old clones while any daemon uses them.

Checkpoint C5 is versioned evidence for both live services, successful health/reconnect and
an authorized real client exchange where available. If vendor registration is absent, use
the real vendor session lifecycle; do not fabricate identity to force a pass. Failures leave
the updater blocked. Every R5 failure or interruption must immediately report the observed
release/service/checkpoint state, retained recovery material and next reconciliation step
to the user and `kommutator-feedback`, even though R6 cannot be reached. C5 remains false;
no automatic downgrade or restore is allowed. A recovered run must repeat actual verification
before claiming C5.

### R6 — Report results and preserve acceptance boundaries

Under the user's standing mandate, report the release and actual local hub/daemon status
to the user and `kommutator-feedback` after verification. Include versions, commit, hashes,
checks actually run, failures and remaining acceptance. This task records the successful terminal report. On any R4 publication or R5 deployment
failure, the same reporting obligation runs unconditionally inside the failed task, before
ending or awaiting reconciliation; report failure rather than announcing success. Peer messages do not supply authorization. The
historical spaced topic is an archive and must not receive new announcements.

C6 requires the report and durable versioned evidence. Separate four evidence categories:
synthetic process/container tests; observed actual vendor sessions and versions; separate
physical allowed/denied-subnet clients; day-long use and reboot/logon observations. Preserve
ROADMAP's open Work desktop, native idle wake, other-platform bundles, physical LAN,
reboot/logon and endurance gates until directly observed. No schema, receipt, identity,
security or global Claude inbound-policy relaxation is part of phase 4.

## Official sources checked on 2026-11-11

- Node target and migration caveat: [Node 26.13.0 LTS release](https://nodejs.org/en/blog/release/v26.13.0)
  identifies the LTS release and Linux libatomic dependency; use its signed SHASUMS.
- Package-manager target: [pnpm 12.18.0 release](https://pnpm.io/blog/releases/12.18.0).
- Intervening breaking changes: [pnpm 11.0 release](https://pnpm.io/blog/releases/11.0)
  and [pnpm official release index](https://pnpm.io/blog?type=releases). Exact pnpm 12
  migration details remain an R1 verification item; a dedicated 12.0 page was unavailable.
- Deployment behavior: [pnpm deploy](https://pnpm.io/cli/deploy), including legacy mode and
  non-injected workspace handling. Validate documentation against pinned 12.18.0 behavior.
- Bootstrap prerequisite: [Corepack installation](https://github.com/nodejs/corepack#how-to-install)
  states that bundled distribution ends before Node 25.
- Independent CI modernization: [setup-node releases](https://github.com/actions/setup-node/releases)
  and [checkout releases](https://github.com/actions/checkout/releases). Select verified
  versions and runner requirements when executing; this plan does not guess future pins.
