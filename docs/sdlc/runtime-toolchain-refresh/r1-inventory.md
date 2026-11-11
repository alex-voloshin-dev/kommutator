# R1 isolated runtime inventory and qualification

Observed 2026-11-11, Linux x64, glibc 2.39. Source snapshot was the accepted
phases 1–3 tree; the worktree subsequently fast-forwarded to `4696264` with the same
source tree. This is C1 investigation evidence, not release or deployment qualification.
No repository implementation, global tool installation, live service or credential changes
were made. Scratch artifacts and logs are retained under `/tmp/kommutator-r1-augv660b`.

## Verified candidates

| Candidate | Verification |
| --- | --- |
| Node 26.13.0 Linux x64 glibc archive | Official signed SHASUMS SHA256 `d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997`; downloaded archive matches |
| Node release signature | GPG GOODSIG and VALIDSIG `C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C` (Richard Lau), fingerprint independently matched official Node README; keyring from nodejs/release-keys |
| Extracted Node | Reports `v26.13.0`; executable SHA256 `0adde40d1b7dfa57c8bc83cbc319758c3ec6ebba21363bb2fa752ea6b267ad1b` |
| pnpm 12.18.0 npm wrapper | Downloaded npm tarball SHA512 and registry ECDSA signature both verified |
| `@pnpm/exe.linux-x64@12.18.0` | Downloaded native tarball SHA512 and registry ECDSA signature both verified; binary reports `12.18.0` in the correctly pinned scratch project |
| pnpm native executable | SHA256 `1664993489436fe2e357dca0dd5e7aed06791c5825dd08bee7aca93c33be96ee` |
| `@types/node@26.6.6` | Exact registry version, downloaded tarball SHA512 and registry ECDSA signature verified; isolated typecheck passes |

Registry signatures were verified with the exact `name@version:dist.integrity` message
and the matching public key from `https://registry.npmjs.org/-/npm/v1/keys`, key ID
`SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`.
The fresh GPG home has no personal owner-trust assignments; its trust warning is expected,
and release-key identity was checked against the official source rather than inferred.
Raw manifests, tarballs, signature, keyring and extracted licenses remain in scratch.
Node LICENSE SHA256 is `8e603aa87c70d36e497004f0dec63111511cb61b7d65ace12e10ea791599286c`.

## Installation and platform decision

Use the verified, exact platform-native pnpm distribution in a private prefix, retaining
its LICENSE and THIRD-PARTY-NOTICES. This was exercised directly; Corepack is unnecessary.
The npm distribution also supports a pinned npm installation into a private prefix, but its
installation scripts/native dependency bootstrap were inspected, not exercised here.
Do not use an unversioned install script or assume Node 26 bundles Corepack.

Verified executables:

- Node: `/tmp/kommutator-r1-augv660b/node-v26.13.0-linux-x64/bin/node`.
- pnpm: `/tmp/kommutator-r1-augv660b/native/package/pnpm`.
- Scratch PATH prefix: `/tmp/kommutator-r1-augv660b/bin` (symlinks to those executables).
- Source copy: `/tmp/kommutator-r1-augv660b/source`.
- Private HOME/XDG paths: scratch `home`, `home/config`, `home/cache`, `home/data`.
- Explicit install store: scratch `store`; deploy used the scratch HOME's default store.

`ldd` resolves every Node and pnpm dependency on this host. Node explicitly links
`libatomic.so.1`, present at `/lib/x86_64-linux-gnu/libatomic.so.1`, as well as glibc,
libstdc++, libgcc, libm, libpthread and libdl. This does not qualify Alpine/musl.
Both current Docker stages are Alpine; R2 must select/verify the exact image digest,
architecture, musl-compatible pnpm artifact and libatomic availability. No Docker image
or systemd service environment was exercised in R1. The updater needs an absolute private
Node executable and a PATH containing the matching pnpm executable before cutover.
pnpm 12 automatically follows an existing packageManager pin: invoking it from the old
checkout reported 10.34.9. Scratch trials first changed the pin to 12.18.0. R2 must verify
both the chosen executable and its effective version, not infer version from its filename.

## Configuration and compatibility matrix

Only the scratch source copy was modified: `packageManager: pnpm@12.18.0`, later exact
`@types/node: 26.6.6`, and this narrowly scoped workspace prerequisite:

```yaml
allowBuilds:
  esbuild: true
```

| Probe | Observed result |
| --- | --- |
| Fresh isolated frozen install with existing settings | FAIL `ERR_PNPM_IGNORED_BUILDS`, specifically `esbuild@0.28.2`; all 233 lock entries passed supply-chain policy |
| Frozen install with explicit esbuild approval | PASS; esbuild postinstall executed successfully |
| Warm frozen repeat | PASS |
| Recursive build, then recursive typecheck | PASS with existing node24 build target and TS7/TS6 compatibility arrangement |
| `deploy --legacy --prod` for hub | PASS; 3 production packages (protocol, ws, zod); no dev-package graph |
| Import deployed `dist/server.js` with Node 26 | PASS; workspace dependency resolves from deployed output |
| Deployment symlinks | All 4 links resolve to existing paths inside deployed directory |
| Production notices | ws and zod LICENSE files present; project LICENSE is missing from deployed output and existing final Docker stage |
| Exact Node types upgrade, non-frozen resolution | PASS; generated lockfile retained in scratch |
| Frozen repeat after types upgrade | PASS; lockfile SHA256 unchanged across repeat |
| Typecheck after Node types upgrade | PASS for all four packages |

No broad build approval, integrity relaxation, release-age exception or agent-skill
installation was used. `allowBuilds` is accepted by the exact pnpm 12.18.0 executable.
Its newer `permissions` feature is not needed for this repository. The first pnpm 12
install prepended a YAML document tracking package-manager dependencies to lockfile 9.0;
this is an actual migration, even though dependency resolution reported up to date.
After exact types migration, the deterministic lockfile SHA256 is
`95bee2b37b97b32891958ed7e22966eb46fa15d57b769c6b8f7ede72acd2900b`.
Baseline lockfile SHA256 was `5816d1137baa2478965bbb311611be56a08745cf900e5cc775a5a6222d5db5c0`.
Logs: `fresh.log`, `approved-install.log`, `warm-install.log`, `build.log`,
`typecheck.log`, `deploy.log`, `types-install.log`, `types-frozen.log`,
`types-typecheck.log`, and `version.log` under the scratch root.

## Active contract inventory for R2

The full `rg` result is retained as scratch `runtime-inventory.txt` (52 matches; historical
reviews, SDLC and spikes excluded). Reviewed active surfaces:

- `.nvmrc`; root engines/packageManager/types; `pnpm-lock.yaml`; workspace settings;
  all four package tsup targets and `removeNodeProtocol: false`.
- `.github/workflows/release-check.yml`; both `docker/Dockerfile` stages, Corepack
  bootstrap and existing legacy deploy path.
- `scripts/export-plugins.mjs` Node guard, esbuild target, metadata description and
  retained licenses; runtime bootstrap, package-client-release and verify-export flows.
- `scripts/release-check.mjs`, `scripts/smoke-hub.mjs`, updater entrypoint and library
  packageManager equality, updater fixtures; source launchers use env Node.
- CLI doctor GUI PATH guidance and hub SQLite source comment.
- AGENTS, CONTRIBUTING, INSTALL, PLUGIN_BUILD, LOCAL_RELEASE_DEPLOY, OPERATIONS,
  CLEANUP_TEST_DATA, FEEDBACK_OBSERVER, FEEDBACK_MAINTAINER, FEEDBACK_TOPIC_MIGRATION,
  vendor source READMEs, current DESIGN runtime descriptions and knowledge instructions.
- Historical MVP build table, dated knowledge observations and old reviews remain dated
  evidence; do not rewrite historical Node24 observations as Node26 observations.

There is no root `.npmrc`; `pnpm-workspace.yaml` initially contained only the package glob.
pnpm 11 general configuration/build-approval migration therefore needs only the explicit
build decision above. pnpm 12 introduces native distribution and strict unknown-setting
validation; existing boolean CLI flags use supported forms. Keep legacy deploy: the exact
candidate passed; no injected-workspace migration is justified by this investigation.

## C1 disposition and remaining gates

Candidate availability, cryptographic verification, native bootstrap and initial isolated
migration are established. C1 is ready for independent review with the explicit esbuild
configuration change above. R2 remains gated on that review. This does not claim full
Node26 release compatibility: build targets/export guards still describe Node24 in the
snapshot, and full tests, release checks, fresh final-lock install, Docker/musl execution,
image digest, updater systemd execution and complete artifact qualification remain R2/R3.
No new tests were added for this evidence-only task. No live vendor, subnet, reboot or
endurance acceptance is closed.

## Official sources

- [Node 26.13.0 release and libatomic requirement](https://nodejs.org/en/blog/release/v26.13.0)
- [Signed Node checksums](https://nodejs.org/dist/v26.13.0/SHASUMS256.txt.asc)
- [Node release keys](https://github.com/nodejs/node#release-keys)
- [pnpm 12.18.0 registry metadata](https://registry.npmjs.org/pnpm/12.18.0)
- [Exact Linux pnpm registry metadata](https://registry.npmjs.org/@pnpm/exe.linux-x64/12.18.0)
- [Exact Node types registry metadata](https://registry.npmjs.org/@types/node/26.6.6)
- [pnpm installation/platforms](https://pnpm.io/installation)
- [pnpm 11 migration changes](https://pnpm.io/blog/releases/11.0)
- [pnpm 12 migration guide](https://pnpm.io/migration-v11)
- [pnpm 12.18.0 changes](https://pnpm.io/blog/releases/12.18.0)
- [Build approvals](https://pnpm.io/cli/approve-builds)
- [Deployment](https://pnpm.io/cli/deploy)

R2 must copy the project LICENSE into the final hub image and R3 must verify its presence.
