---
type: review
target: Working directory readiness for a public English-language repository
iteration: 1
verdict: changes
date: '2026-10-29'
findings:
  - severity: blocker
    location: README.md:159; scripts/export-plugins.mjs:31
    issue: No project license exists and the exporter does not include one.
    suggestion: Add an explicit open-source license and ship it in both plugin artifacts.
  - severity: major
    location: docs/WINDOWS_LAN_SETUP.md:20
    issue: Fresh Docker onboarding assumes pre-existing private configuration and storage.
    suggestion: Document a complete fresh installation before the compose startup commands.
  - severity: major
    location: README.md:3
    issue: The opening native-wake claim exceeds implemented vendor capabilities.
    suggestion: Describe current capabilities and provide an evidence-based support matrix.
  - severity: major
    location: package.json:10; scripts/test-plugin-export-e2e.mjs
    issue: Public binary releases have no automated artifact validation gate.
    suggestion: Add CI and one release-check command covering export, checksums, smoke and synthetic E2E.
  - severity: minor
    location: PROJECT_REVIEW.md; docs/reviews/
    issue: Five historical review documents are Russian and the root review presents an obsolete baseline.
    suggestion: Keep original history privately and publish a concise English rationale where useful.
  - severity: minor
    location: spikes/evidence/2026-10-27-m2-installed.json:47; README.md:21
    issue: Public-facing files contain installation-specific paths, configuration and raw transcripts.
    suggestion: Curate and redact public evidence while preserving original records separately.
  - severity: minor
    location: docs/sdlc/repo-onboarding/onboarding.md
    issue: The recommended contributor map primarily describes a historical scaffold.
    suggestion: Create a current map and demote the original to a dated archive.
  - severity: minor
    location: plugins/codex/README.md:8; docs/sdlc/plugin-distribution/BUILD.md
    issue: Manual integration and bundled-plugin installation are competing entry paths.
    suggestion: Promote a single public client guide and explicitly label manual integration prerequisites.
  - severity: minor
    location: .gitignore
    issue: Known secret and runtime file formats are not ignored consistently.
    suggestion: Exclude key files, hub.env and SQLite sidecars and inspect the actual first-commit manifest.
  - severity: minor
    location: docker/Dockerfile.dockerignore; docker/Dockerfile:5
    issue: Local plugin artifacts are included in the Docker build context.
    suggestion: Exclude .artifacts from the Docker context.
  - severity: minor
    location: scripts/export-plugins.mjs:59; packages/cli/src/mcp.ts:19
    issue: Plugin manifests and runtime diagnostics report different hardcoded versions.
    suggestion: Use one release version source and expose runtime content identity separately.
  - severity: minor
    location: README.md:20; docs/DESIGN.md:677
    issue: The trusted-LAN security boundary is not sufficiently visible in the public introduction.
    suggestion: State the shared trust domain and unencrypted HTTP/WS limitation near deployment guidance.
---

# Public repository readiness review

Historical baseline: these findings were subsequently addressed by
[public source preparation](../public-preparation/implementation.md). The original review
verdict and observations below are retained as the pre-change record.

The source is worth publishing, but the current working directory should not be published
unchanged. The main work is licensing, a complete first-user path, accurate capability
claims and separation of product documentation from local implementation history. This
review does not recommend rewriting the core or reopening accepted protocol decisions.

The user's request specifies an English public repository and a free/open-source license.
No exact license was specified. This is a review, not authorization to publish, delete
history or migrate the running installation. Only this report was added; generated build
outputs were refreshed by verification. No application source or deployment was changed.

## Verified findings

### R1 — Blocker: project licensing is absent from source and distributions

[README](../../../README.md:159) still says the license is unchosen. There is no root
LICENSE and workspace manifests do not declare a license. The
[exporter](../../../scripts/export-plugins.mjs:31) copies Node and third-party notices,
but never the project's own license; its generated README also says licensing is open.
A fresh export contains NODE-LICENSE and dependency notices, not a project LICENSE.
Adding a root license alone therefore will not complete binary distribution preparation.

**Fix:** choose MIT as the default recommendation for a short permissive license, identify
the intended copyright holder, add LICENSE and SPDX metadata, copy the license into each
standalone plugin, and check it in the release gate. MIT permits use, modification and
commercial redistribution while requiring preservation of its notice. See the
[official MIT text](https://opensource.org/license/mit). Apache-2.0 is an alternative if
an explicit contributor patent grant is desired; see its
[official terms](https://www.apache.org/licenses/LICENSE-2.0). Preserve third-party notices
independently of the project license. This review did not audit every dependency's license
compatibility and does not infer rights over third-party material from the user's choice.

### R2 — Major: a fresh user cannot follow the Docker quickstart as written

The [deployment guide](../../WINDOWS_LAN_SETUP.md:20) starts in the author's absolute
checkout and immediately runs Compose. Its later table describes already-created secrets
and data. [Compose](../../../compose.yaml:30) deliberately disables automatic creation of
the data bind path and requires an existing secret file. The guide says these must exist,
but does not give the complete initial creation sequence before startup.

**Fix:** a portable first-install guide must create private directories, generate the key
without printing it or putting it in command arguments, set ownership using the actual
UID/GID, then build/start and verify authentication. Keep existing-machine migration,
retired services and old shell group membership in historical records. Preserve the fixed
8787 default and loopback publication. No need to change the existing deployment.

### R3 — Major: the introductory compatibility promise is too broad

[README](../../../README.md:3) promises native push through each vendor. The
[Codex adapter](../../../packages/agentd/src/adapters/codex.ts:13) has hook capability;
the [generic adapter](../../../packages/agentd/src/adapters/generic.ts:8) has none and
returns inbox delivery. Detailed Codex docs accurately describe these limits, but the
opening claim does not.

**Fix:** lead with messaging, topics and boards. Publish a small support matrix separating
native Claude wake, Codex hook delivery, generic pull behavior, loader availability and
platform evidence. Do not call Copilot, cloud Work or native Windows plugins supported.
Historical macOS source-client evidence is not qualification of the new macOS artifact.

### R4 — Major for binary releases: artifact checks are outside an automated gate

[Root scripts](../../../package.json:10) run workspace build/typecheck/Vitest. There is no
.github directory. Export smoke and [synthetic plugin E2E](../../../scripts/test-plugin-export-e2e.mjs)
are separate scripts; the build guide omits the E2E command. Workspace tests can pass while
the actual bundled product has a packaging regression.

**Fix:** retain the useful existing tests and add one release-check command and CI job:
frozen install → build → typecheck → tests → fresh export → checksum/license verification
→ clean-PATH smoke → synthetic E2E. Initially qualify Linux x64 only. Add other platform
jobs when executable evidence exists. This is a release-readiness gap, not evidence that
the current export fails: the current export passed these checks during this review.

### R5 — Minor, required for English-only publication: curate historical Russian reviews

[Root PROJECT_REVIEW](../../../PROJECT_REVIEW.md) and four files under
[docs/reviews](../../reviews/PROJECT_REVIEW.md) contain Russian prose. The root review
also describes an obsolete scaffold. Root and archived copies are not byte-identical;
therefore deleting one as an exact duplicate would be unjustified.

**Fix:** preserve originals in a private archive, extract still-relevant rationale into an
English historical summary, and remove the obsolete root entry from the public tree after
checking references. The other Russian reviews are PROJECT_REVIEW_FOLLOWUP_2026-10-24.md,
PROJECT_REVIEW_FOLLOWUP_2026-10-25.md and SIX_HATS_REVIEW_2026-10-25.md. Do not translate or
remove Unicode test fixtures: Russian/Japanese/emoji test data serves a different purpose.

### R6 — Minor: public material embeds one workstation's operational history

Examples include absolute paths in
[hook trust evidence](../../../spikes/evidence/2026-10-27-m2-installed.json:47), raw
[session transcripts](../../../spikes/evidence/2026-10-25-m1-production.json:368), the
specific LAN endpoint in README and local shell state in the deployment guide. These are
unnecessary details for a general installation and contributor path.

**Fix:** publish minimal redacted evidence retaining vendor versions, conditions, observed
results and limitations. Keep original records separately. Replace operational examples
with clearly identified placeholders; do not relabel edited evidence as untouched raw
output. Keep stable port 8787 and the single-subnet policy. Private IPs, session IDs and
hook hashes are not treated as passwords; no real credential leak was confirmed.

### R7 — Minor: the main contributor map is historical

The [onboarding map](../repo-onboarding/onboarding.md) correctly labels its old baseline,
but most of its content still describes stub components and old tests. README and AGENTS
recommend it as an initial map. MVP_PLAN also retains old component counts and a long
revision history, making current state hard to locate.

**Fix:** create a concise current architecture/contributor map and a current roadmap;
retain historical acceptance and rationale separately. Keep protocol authority, identity
rules, test commands and evidence gates in the contributor instructions. Remove local
machine assumptions and mandatory dependence on a privately installed agentic-forge path
from the public contribution path. Optional maintainer workflows may remain documented.

### R8 — Minor: manual and bundled installations need a clear hierarchy

The new bundle guide is buried under docs/sdlc. Source plugin directories still describe
manual kom/Node setups. [Codex instructions](../../../plugins/codex/README.md:8) start with
`kom init --vendor codex`, although a first client must already supply a valid key through
configuration or another supported input. The existing-config assumption comes later.

**Fix:** promote one public client-install guide, with the bundled private-form flow first.
Label source/manual templates as advanced alternatives and state their configuration
prerequisites before commands. Link all plugin READMEs to that guide. Keep build/release
instructions distinct from end-user installation. Avoid installing both manual and plugin
hooks; preserve the existing conflict detector and normal hook trust flow.

### R9 — Minor: align Git exclusions with known runtime/secret formats

[.gitignore](../../../.gitignore) omits `*.key`, `hub.env`, `*.sqlite`, `*.sqlite-wal` and
`*.sqlite-shm`, although Docker ignore already recognizes these formats. Current configured
secrets are outside the tree; this is prevention of accidental future inclusion, not a
confirmed exposure.

**Fix:** align exclusions, preserve intentional example files explicitly, and inspect the
exact first-commit file list with a secret scan. Ignore patterns alone are not a guarantee.

### R10 — Minor: exported binaries enter the hub build context

[Docker ignore](../../../docker/Dockerfile.dockerignore) does not exclude .artifacts, while
[Dockerfile](../../../docker/Dockerfile:5) uses `COPY . .`. That local directory currently
occupies about 333 MB. Git ignore does exclude it, but Git ignore does not control Docker.

**Fix:** exclude .artifacts from Docker context. This reduces upload/storage and cache
invalidation. Inclusion in the builder is supported by the copy/filter rules; this review
did not demonstrate inclusion in the final runtime image and does not claim such a leak.

### R11 — Minor: release identity is inconsistent

[Exporter](../../../scripts/export-plugins.mjs:59) emits 0.1.0 in release/plugin manifests;
workspace packages, [MCP identity](../../../packages/cli/src/mcp.ts:19) and daemon diagnostics
still use 0.0.0. These are separate hardcoded values.

**Fix:** one authoritative release version, included in generated manifests and diagnostics.
Retain the separate runtime content hash and runtime-contract compatibility version; they
serve different purposes. A development preview can remain unpublished, but should be
identifiable when users report problems.

### R12 — Minor: make the existing security boundary visible to users

[DESIGN security](../../DESIGN.md:677) explicitly accepts unencrypted HTTP/WS on one trusted
subnet and defers stronger identity/authz. [Host hello](../../../packages/hub/src/sessions.ts:37)
accepts the host name from a client authenticated with the shared key. This is a shared
trust domain, not isolation between mutually untrusted users.

**Fix:** state this briefly in README/deployment guidance and add SECURITY.md with supported
scope and a real vulnerability-reporting route once chosen. Do not imply that subnet
filtering provides encryption. No new protocol/auth subsystem is required by this review.

## What belongs in the public repository

| Material | Recommended disposition | Reason |
| --- | --- | --- |
| packages/*/src, tests, schema.sql, dashboard assets | Keep | Product and executable behavior contracts |
| plugins/, scripts/, docker/, compose.yaml | Keep; clarify source templates versus generated plugins | Reproducible installation and packaging |
| pnpm-lock.yaml, workspace manifests, tsconfig, .nvmrc, editor configuration | Keep | Toolchain and dependency reproducibility |
| README, DESIGN, PROTOCOL, OPERATIONS | Keep and update public entry paths | User behavior, contracts and operations |
| AGENTS.md and CLAUDE.md | Keep concise portable contributor rules | Useful for contributors across tools |
| docs/knowledge | Curate and retain useful current architecture/decision notes | Avoid losing accepted rationale |
| MVP_PLAN | Retain historical acceptance; extract a short current roadmap | Separate completed history from next work |
| docs/sdlc and docs/reviews | Keep selected English decisions/evidence; archive repetitive internal handoffs | Preserve provenance without overwhelming new readers |
| spikes scripts and RESULTS | Keep reproducible experiments and concise redacted conclusions | Vendor behavior is evidence-dependent |
| Raw transcripts, machine inventory, detailed trust paths, temporary run outputs | Keep originals privately; publish minimum redacted evidence where needed | Privacy and reader relevance |
| Screenshots | Keep selected demonstrative screenshots; archive repetitive QA states | A useful dashboard image is stronger than many test-state captures |
| .artifacts, node_modules, dist, caches, DB/WAL, keys, logs | Exclude from source commits | Generated output or runtime data |
| Plugin archives and checksums | Publish as release assets after gates | Avoid committing duplicated bundled Node binaries |

A public-facing structure can remain small: README, LICENSE, CONTRIBUTING, SECURITY;
docs for installation, development, architecture/protocol and evidence; the existing code,
plugins, scripts and Docker layout. Moving files should preserve or update inbound links.
No new architecture or wholesale code rewrite is justified by these findings.

## Verification and independent lenses

Three fresh independent reviewers covered (1) security/privacy/file hygiene, (2) public
documentation and onboarding, and (3) packaging, licenses and release checks. The parent
reopened every accepted substantive location, checked the inventory and independently
reran artifact checks. The optional external CLI reviewer was not invoked for the
unsanitized publication candidate; no additional external-review approval is claimed.
No runtime-adapter file was found in the installed skill package; the skill's documented
fresh general-purpose reviewer mechanism was used.

| Check performed during this review | Result |
| --- | --- |
| Source/config/evidence inventory excluding dependencies and generated outputs | 227 candidate files before this report |
| Build with Node 24.22.1 / pnpm 10.18.0 | Passed, four workspace packages |
| Workspace typecheck | Passed |
| Workspace tests | Passed: 30 protocol + 141 hub + 50 agentd + 103 CLI = 324 |
| Fresh Linux x64 plugin export, independent packaging reviewer | Passed |
| Fresh artifact checksums, independently rechecked by parent | 412 entries matched |
| Clean-PATH smoke for both exported vendors, independently rerun by parent | Passed |
| Synthetic cold start/roots/messaging/board/cache removal/survival/restart/offline queue, independently rerun by parent | Passed |
| Text search for credential patterns and machine-specific data | No confirmed real credentials; local paths/transcripts found |
| Visual sample of setup-success and populated-dashboard screenshots | No exposed credential observed; QA fixture image is not a product marketing screenshot |

Logs for this run are temporary verification outputs, not public source artifacts:
`/tmp/kom-public-build.log`, `/tmp/kom-public-typecheck.log`, `/tmp/kom-public-test.log`,
`/tmp/kom-public-smoke.log`, `/tmp/kom-public-e2e.log`.

## Clean areas and filtered findings

- Keep the existing isolation/auth defaults: loopback publication, non-root/read-only
  container, dropped capabilities, private config permissions, authenticated HTTP/WS,
  browser setup Host/Origin/CSRF checks and create-only config persistence.
- Keys in reviewed evidence were board keys or hook-trust lookup paths, not credentials.
  Obvious test keys and Unicode test fixtures are not secret/English-only violations.
- Historical onboarding is explicitly labeled historical; the issue is its prominence,
  not a claim that the old test results were fabricated.
- HTTP without TLS is an accepted documented scope limitation; do not report it as a newly
  discovered implementation regression or silently expand the LAN policy.
- Docker builder context inclusion is not proof of final-image exposure.
- Source publication does not require public marketplace approval or immediate npm release.
  Keep these distribution channels separate.

## Remaining limits and recommended sequence

This is a publication-readiness review with targeted code/security inspection, not an
exhaustive proof of code correctness. There was no fresh dependency install, CVE audit,
complete transitive-license compatibility audit, external firewall test, Docker rebuild,
reboot test, new real-vendor conversation or execution on another OS. No Git history exists
to scan. Generated dependency trees and every archive/image were not exhaustively scanned.

Previously observed Codex hook latency (roughly 0.75 seconds end to end), snapshot-lock
hard-kill recovery and unqualified platforms remain documented product limits. Passing the
synthetic checks does not close those limits, native wake, external subnet or day-long-use
gates. No claim of universal vendor support is warranted.

Recommended sequence:

1. Apply license, public English documentation and redaction/disposition changes; preserve
   private originals before removing public candidates.
2. Fix exclusions/version metadata and add CI/release checks; run them on the final tree.
3. Inspect the exact proposed initial Git contents and secret-scan that set. Initialize and
   commit only the curated source when proceeding to the already-unblocked Git plan step.
4. Publish source separately from binary releases. Release only the platform/vendor matrix
   actually qualified; migrate the local manual installation and run a real exchange as a
   separate plugin acceptance step.
