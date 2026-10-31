# Client and hub distribution

## Install the client from GitHub

The repository is a Git-backed marketplace for Claude Code and Codex CLI. Follow the
[two-command client installation](QUICKSTART.md#2-install-the-client-each-agent-computer).
The marketplace name is `kommutator`; the plugin identifier is `kommutator@kommutator`.
This is a repository marketplace, not a listing or approval in either vendor's public directory.

Claude Code 2.1.224+ installs a complete plugin ZIP from
[GitHub Releases](https://github.com/alex-voloshin-dev/kommutator/releases), verifying the SHA-256
pinned in its root marketplace catalog. Downloading during installation avoids the MCP
startup deadline. Codex installs a lightweight plugin under `plugins/hosted/codex`: its first
MCP start downloads the versioned Linux x64 tarball, checks the source-pinned SHA-256, and
extracts it into private local storage. The bundled Node runtime starts MCP and the private
setup form. Hooks only use an already-installed runtime;
they never install or download. Updating a plugin selects a new explicitly pinned runtime;
it never fetches an unversioned `latest` asset.

The release also provides an archive and checksum for offline/manual distribution. Keep
its extracted folder if using its local `kommutator-local` marketplace. GitHub's automatic
“Source code” downloads are not client bundles. Node and dependency license notices are
included in the bundle. Linux x64 / WSL2 is the qualified packaging target; macOS, ARM,
native Windows, cloud Work and Copilot remain separate work.

## Hub

The hub currently builds using Docker Compose; see [quickstart](QUICKSTART.md).
A public GHCR image and pull-only Compose deployment pinned by digest remain planned.
The client release does not publish or upgrade the hub. Its private key, persistent database,
loopback default and stable TCP 8787 endpoint remain unchanged.

## Maintainer release procedure

1. Bump the root package version and run `pnpm version:sync`. Install with
   `pnpm install --frozen-lockfile`, then run `pnpm -r build`, `pnpm -r typecheck` and
   `pnpm -r test`. The full release gate also checks generated catalog versions, so run it
   after regeneration in step 3 rather than against stale catalogs.
2. Export a fresh artifact using `node scripts/export-plugins.mjs /absolute/fresh/export`.
3. Run `node scripts/package-client-release.mjs /absolute/fresh/export /absolute/fresh/release`.
   This verifies the export, makes the versioned tarball, Claude ZIP and checksums, and regenerates the
   tracked hosted plugin and both root catalogs with the exact archive hashes.
4. Review those generated files and rerun the release checks, including hosted installer
   failure, concurrency and offline cases. Scan the candidate source/history and artifact
   for secrets. Never include a developer's configuration or credentials.
5. Commit the reviewed source. Publish the exact archive and checksum as a development-preview
   GitHub Release from that revision; publish assets before directing users to the catalogs.
   Never replace an existing version tag or asset silently. Corrections need a new version.
6. Verify anonymous download and the downloaded checksum. Install both plugins through their
   real vendor CLIs in separate clean homes, and check MCP startup/setup using the published asset.
   Record execution evidence and unvalidated platforms in the release notes.

Ordinary CI checks packaging but does not publish releases or change user plugin configuration.
For source rationale and official vendor links, see the
[distribution research](sdlc/public-launch/research-brief.md).
