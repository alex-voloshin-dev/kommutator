# Published 0.3.0 verification

Observed 2026-11-01. [Release v0.3.0](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.3.0)
is published as a development preview with the Linux x64 tar archive, Claude ZIP and both
checksum files. The tag points to `798d4c1`, with the reviewed runtime change in `0097d02`.
The marketplace catalogs on main advanced only after the release assets were available.
No existing release tag or asset was overwritten.

## Public assets and native installation

Both archives and their checksum files were downloaded anonymously over HTTPS. SHA-256
checks passed, and downloaded bytes matched the exact locally qualified archives.

Real Claude Code 2.1.310 and Codex CLI 0.164.0 installed `kommutator@kommutator` from the
public GitHub marketplace into separate empty vendor profiles. Both selected 0.3.0.
The installed Codex launcher downloaded and verified its public pinned runtime. Both
installed MCP servers initialized as version 0.3.0, listed tools, returned unconfigured
setup status and served a private loopback setup form. Cold initialization took 1.034
seconds for Claude and 6.556 seconds for Codex; these individual observations are not
performance guarantees.

The full configured E2E harness passed against copies of the actual installed Claude
bundle and the runtime downloaded by the installed Codex launcher. The checks included
stale MCP launch IDs, in-process A → B → A, predecessor retirement, delayed hooks,
independent owners sharing a vendor ID, stable repeated SessionStart, cross-vendor
messages/boards, cache deletion, daemon restart and offline queue recovery. The test hub,
identities and credentials were synthetic. Native plugin CLI installation was real;
interactive model conversations and UI resume on the reporting computer were not tested.

## CI and security

GitHub checks for release commit `798d4c1` passed on both main and the release tag:

- [Main release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41342114234)
- [Main secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41342114200)
- [Tag release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41342060014)
- [Tag secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41342060016)

The preceding local release gate passed 386 workspace tests, 44 script tests and artifact
qualification. Source/history Gitleaks and known-local-credential comparisons passed.
Two artifact scanner findings were verified as public license checksum values; no broad
scanner exclusions were introduced. Detailed intermediate failures and corrected candidates
remain in [QA](qa.md).

## Upgrade and remaining gates

Follow the [release upgrade instructions](release.md): update all client plugins on a
computer, restart its shared daemon once, and resume the existing conversation. Runtime
contract 3 and local state schema 2 require this coordinated client upgrade; the hub does
not require updating. Schema migration preservation has unit coverage; the published
runtime E2E above checks restart at the new version, not a live production upgrade.

The existing Docker hub, active user vendor profiles and the feedback observer were not
restarted or reconfigured. Native wake after resume, the reporting computer, macOS bundles,
Windows reboot, physical outside-subnet checks and day-long operation remain separate gates.
