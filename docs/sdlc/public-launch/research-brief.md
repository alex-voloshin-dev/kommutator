---
type: research-brief
feature: public-launch
status: approved
date: '2026-10-31'
sources:
  - 'https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases'
  - 'https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry'
  - 'https://code.claude.com/docs/en/plugins/host-marketplace'
  - 'https://code.claude.com/docs/en/plugins/publish'
  - 'https://developers.openai.com/plugins/build/plugins'
  - 'https://developers.openai.com/plugins/deploy/submission'
  - 'https://developers.openai.com/plugins/deploy/desktop-only'
  - 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference'
---

# Distribution and first-user installation

Question: how should this public MIT project distribute client plugins (skills, MCP, hooks,
application and bundled Node) and the Docker hub, with a short first-user path?

Two independent tracks examined current vendor/registry documentation and the actual local
installation path. The parent checked load-bearing source statements. This is a release
recommendation, not a claim that binary assets, images or vendor listings already exist.

## Internal findings

The exporter already creates two vendor plugins, local catalogs, Node/application payloads,
licenses and checksums. A source checkout does not contain those generated payloads.
The Linux x64 artifact has loader and synthetic acceptance; other bundles and Copilot are
unqualified. The hub Dockerfile and hardened Compose are implemented. These facts are
observable in scripts/export-plugins.mjs, compose.yaml and recorded plugin evidence.

The previous fresh-hub path required a long shell block and remembering UID/GID variables
for later operations. The scoped implementation replaces that default path with
`scripts/hub.sh`, preserving a separate advanced guide. It must retain private create-only
key setup, persistent storage, actual UID/GID and loopback TCP 8787. No helper may silently
open LAN or recreate another deployment. See [quickstart](../../QUICKSTART.md).

## External findings

GitHub Releases can attach binaries to a tagged source revision. GitHub's automatic source
archives are different from a bundled application asset. Therefore label client downloads
explicitly and publish an outer archive checksum as well as the internal inventory.
[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

The first client release can preserve the already-tested cross-vendor route: extract a
versioned Linux x64 archive into a durable directory, add its local catalog, install the
vendor plugin and use its private connection form. Current Claude documentation describes
relative-path local plugins loading in place; keep that extracted directory. A later
Claude-specific hosted catalog can point to an archive source rather than committing Node
binaries to Git. Current relative-path catalogs must not simply be hosted as standalone
JSON URLs. Qualify that archive route separately.
[Claude marketplace hosting](https://code.claude.com/docs/en/plugins/host-marketplace)

OpenAI documents local/Git marketplace packaging, but public directory submission has
additional restrictions: lifecycle-hook packages cannot currently be submitted, and local
MCP submission requires approved-partner allowlisting. Our hooks are required for current
identity/context behavior, so do not remove them merely to obtain a listing. Distribute
manually first; do not advertise directory approval.
[Packaging](https://developers.openai.com/plugins/build/plugins),
[submission restrictions](https://developers.openai.com/plugins/deploy/submission),
[local MCP eligibility](https://developers.openai.com/plugins/deploy/desktop-only)

Copilot documents plugin/MCP/skill packaging, but compatible manifests alone do not verify
this application's session identity or delivery. Keep it unqualified until those behaviors
are observed. Claude's public directory also has its own submission process; repository
publication does not establish listing acceptance or support in every Claude product.
[Copilot reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference),
[Claude publishing](https://code.claude.com/docs/en/plugins/publish)

GHCR permits anonymous pulls of public container images and Actions publication using the
repository GITHUB_TOKEN. First package publication defaults private, so explicitly verify
public visibility and an unauthenticated pull. Version tags should follow a never-overwrite
policy; installation should pin the image digest rather than assume tags are immutable.
Link source/revision/version/license metadata to the public repository.
[GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## Recommendation and delivery order

1. Publish the audited source repository now, with the simple source-based hub helper and
   honest current client-install instructions.
2. Make the first binary release an explicit Linux x64 development preview from one tested
   commit: `kommutator-v<VERSION>-linux-x64.tar.gz`, archive checksum, included notices and
   supported-client notes. Download it as a consumer, extract, verify and exercise it before
   advertising it as available. Do not use Git LFS for embedded runtime distribution.
3. Publish the hub as `ghcr.io/alex-voloshin-dev/kommutator-hub:<version>` from that commit.
   Ship a pull-only Compose deployment pinned to its digest, retaining the secret mount,
   data mount and loopback default. Check anonymous pull, fresh setup, restart and backup.
   This removes source builds from the eventual end-user path.
4. Add vendor-specific hosted catalogs only after fresh installation tests. Public-directory
   submissions, macOS bundles, Copilot and cloud/desktop behavior have separate gates.

GitHub Releases plus GHCR is the smallest proposed distribution surface because source is
already destined for GitHub. This is an engineering recommendation, not a requirement of
the vendor protocols. Docker Hub can be a later mirror if there is demand.

Do not conflate binary publication with real migrated-plugin conversation acceptance, native
wake, external-subnet isolation, reboot or full-day use. Preserve these open evidence gates.
No fifth-grade usability study was run: the practical verification is step-by-step execution
and failure testing, plus independent review of the instructions.
