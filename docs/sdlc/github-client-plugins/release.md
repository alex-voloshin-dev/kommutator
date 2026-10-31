---
type: release
feature: github-client-plugins
status: final
version: '0.2.0'
changelog:
  - 'GitHub marketplace installation for Claude Code and Codex CLI'
  - 'Versioned Linux x64 runtime with pinned checksum and private browser setup'
breaking: []
---

# kommutator 0.2.0 — client installation preview

## Added

- GitHub marketplace catalogs for Claude Code and Codex CLI.
- Linux x64 / WSL2 client bootstrap with bundled Node, MCP, hooks and skills. The first
  Codex MCP launch downloads a fixed GitHub Release archive and verifies its source-pinned
  SHA-256; Claude uses a complete pinned ZIP downloaded by its native plugin installer.
- Private, concurrent-safe runtime installation outside vendor caches; hooks never download.
- Two-command installation and a private browser form for the hub URL, computer name and key.

## Release scope

This first binary release includes the existing MIT source baseline: authenticated Docker
hub, shared boards/messages, daemon, MCP, hooks, and local bundled-client setup. Earlier
public source commits were reviewed in the public-launch handoff. The release helper sees
no previous tag; all root-to-HEAD commit subjects were collected explicitly. The new feature
advances the existing 0.1.0 manifest to 0.2.0 by semver. No wire-contract change is introduced.

This release publishes the client artifact only. It neither publishes a GHCR image nor
upgrades an installed hub or older daemon. Existing manual users must follow the documented
migration steps; do not run duplicate manual and plugin hooks.

## Validation

The full release gate passed: 328 workspace tests and 29 script tests, build, typecheck,
audit (zero known vulnerabilities), hosted catalog consistency, clean-PATH MCP/private setup
checks and synthetic cross-vendor lifecycle tests. Independent correctness and security
reviews approved. See [implementation](implementation.md) for scope and execution evidence.
The published assets passed both vendor CLI installation paths, MCP startup and private
setup form checks; see [publication evidence](publication.md).

## Not validated

- macOS or ARM bundles, native Windows clients, Copilot, cloud Work, or desktop GUI installation.
- External allowed/denied-subnet access from a separate physical client, reboot/logon,
  full-day real use, and capacity limits.
- Native idle wake for Codex; this integration delivers through hooks.
- Real exchange after migration from manual integration to the published plugin.

See [quickstart](../../QUICKSTART.md), [migration instructions](../../INSTALL.md), and
[distribution details](../../DISTRIBUTION.md).
