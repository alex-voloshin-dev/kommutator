# Published 0.2.2 upgrade verification

Observed 2026-10-31. Release [v0.2.2](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.2.2)
contains the Linux x64 tar archive, Claude ZIP and both checksum files. The tag points to
`b17e132`; the marketplace catalogs were advanced only after the assets were available.
No existing release assets or tags were overwritten.

## Installed-client checks

- Real Claude Code 2.1.310 CLI refreshed the GitHub marketplace and upgraded an isolated
  existing user-scope installation from 0.2.1 to 0.2.2.
- Real Codex CLI 0.164.0 refreshed the marketplace and installed 0.2.2 over the isolated
  0.2.1 profile. Its pinned launcher downloaded and verified the published archive.
- Both installed plugins initialized MCP, listed tools, returned setup status and served
  the private setup form. Measured cold initialization was 1.34 seconds for Claude and
  6.04 seconds for Codex; these observations are not performance guarantees.
- The full configured E2E harness passed using the actual installed Claude bundle and
  the Codex bundle downloaded by its installed launcher. This includes two synthetic
  Claude owner processes with one vendor ID, isolated statuses/inboxes, a complete
  liveness sweep, owner-only SessionEnd, cross-vendor messaging, marketplace metadata,
  cache deletion, daemon restart and offline queue recovery.

## Actual daemon contract upgrade

An isolated 0.2.1 daemon was started using its real `bin/manage daemon restart` command
and a synthetic local hub/configuration. The installed 0.2.2 MCP reported the old
contract-1 daemon as incompatible without changing its PID. Running the installed
0.2.2 `bin/manage daemon restart` created a contract-2 daemon with version 0.2.2;
MCP setup status then reported compatible. Configuration bytes, database inode and
an existing persisted local key/hub session ID were preserved. This verifies storage
preservation, not continuity of an already-running agent session; sessions must reopen.
Temporary daemons, clients, hub and configuration were cleaned up. No real key or
user profile was used or modified.

## CI and security

For the release commit `b17e132`, GitHub Release checks and Secret scan both passed on
main and the release tag:

- [Main release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41242765307)
- [Main secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41242765356)
- [Tag release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41242728996)
- [Tag secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41242729065)

Local history Gitleaks and known-local-credential comparison passed before publication.
Artifact checks and the two verified license-checksum scanner matches are recorded in
[QA](qa.md). Version 0.2.1 release notes now direct affected users to the correction.

## Evidence boundary

CLI plugin installation/upgrade was real. MCP conversations and owner processes were
synthetic fixtures; no live Claude model conversation or second-physical-computer
acceptance is claimed. The user's installed clients require the documented update and
one-time daemon restart. The existing Docker hub and live development profiles were
not restarted or modified by this release verification.
