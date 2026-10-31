# Published client installation evidence

Observed 2026-10-31 with Claude Code 2.1.310, Codex CLI 0.164.0, Node 24.22.1,
Linux x64 / WSL2 Ubuntu. Release source commit: `c31a0c9`.

[GitHub Release v0.2.0](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.2.0)
is public and marked development preview. Both archives and their checksum files are attached.
The root catalogs are published on main. The GitHub repository marketplace is not an official
Claude/OpenAI public-directory listing.

## Observed consumer checks

Using fresh isolated HOME, CODEX_HOME and CLAUDE_CONFIG_DIR directories:

- Claude CLI added `alex-voloshin-dev/kommutator` and installed `kommutator@kommutator`
  from the native release ZIP. Its `mcp list` reported the installed plugin **Connected**.
- Codex CLI added the same GitHub marketplace and installed version 0.2.0. Its `mcp list`
  exposed the enabled stdio launcher, installed cwd and 180-second startup allowance.
- A cold Codex MCP launch downloaded the public tarball through the pinned HTTPS URL,
  verified it and initialized in 5.62 seconds on this connection. The installed Claude
  MCP initialized in 1.08 seconds. These timings are observations, not guarantees.
- Both installed MCPs exposed the expected tools, returned successful `setup_status` and
  `setup_start`, and served the private browser form with HTTP 200. No real hub key was
  submitted or copied into these test profiles.
- A separate Claude marketplace addition with SSH deliberately disabled and Git credential
  helpers cleared succeeded through anonymous HTTPS fallback. Users need no GitHub account
  for this public marketplace.

These checks prove installation, loading and private setup availability. They do not claim
real model-to-model exchange after migrating an existing manual installation, desktop GUI
acceptance, or any other previously open platform/network gate.

## Security and CI

The exact tracked source candidate and all three commits through the release source passed
Gitleaks with no findings after applying the repository's narrowly scoped fixture allowances.
Known real local hub/client keys, GitHub credentials and SSH private-key material were compared
against candidate files and reachable Git blobs without printing them; no matches were found.
The complete exported runtime, including generated app code and binaries, also had no such match.

Artifact Gitleaks produced two findings: both were SHA-256 inventory values for the public
`path-key` dependency's MIT license. The independent security reviewer recomputed both license
hashes and confirmed they are public checksums, not credentials. No broad scanner exclusions
were added to hide those findings.

Hosted checks for the release source passed:

- [Main release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41233401039)
- [Main full-history secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41233401172)
- [Tagged release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41233385497)

Local independent QA passed 328 workspace plus 29 script tests and synthetic lifecycle
acceptance; see [implementation](implementation.md). The live Docker hub and existing vendor
configuration were not changed. Only temporary test profiles installed the new plugins.
