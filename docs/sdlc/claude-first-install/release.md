---
type: release
feature: claude-first-install
status: approved
version: 0.5.0
changelog:
- section: Added
  entries:
  - Opt-in deployment of qualified releases to the local hub and daemon.
- section: Fixed
  entries:
  - Verify non-root release images before local activation.
  - Give exact Claude exit and resume instructions for missing plugin registration.
breaking: []
---
# kommutator 0.5.0 development preview

## Added

- Opt-in local updater for qualified releases, with exact-commit CI checks, isolated image
  verification, backups and explicit blocked-state reconciliation.

## Fixed

- Verify non-root release images before local activation.
- Missing Claude plugin registration now explains how to run `/exit`, then `claude --resume`
  from the same project and select the conversation. Trust the updated hooks so SessionStart
  can register it. `/reload-plugins` alone and a compatible daemon do not create missing
  SessionStart authority; `setup_status` does not prove session registration.

Runtime contract remains 3. This maintenance task changes no live services or client profiles.

## Validation

Build, typecheck and all 393 workspace tests passed on Node 24.22.1 / pnpm 10.18.0.
`pnpm release:check` passed: dependency audit (no known vulnerabilities), 77 script tests,
fresh export integrity/licenses, clean-PATH startup/setup and synthetic cross-vendor/recovery
E2E. Independent code/security review and focused QA approved. Initial sandbox restrictions and
transient SQLite fixture timeouts were resolved by approved, unchanged reruns. See the
adjacent review artifact for secret-scan evidence and the optional external-review limitation.

## Not validated

Live Claude first-install resume and hook trust on the reporting host, real vendor installation
of this release, macOS/ARM execution, Work UI/native idle wake, physical subnet clients,
reboot/logon and day-long operation remain open. Synthetic checks do not close these gates.
