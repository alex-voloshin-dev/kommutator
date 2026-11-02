---
type: release
feature: feedback-discovery
status: approved
version: 0.6.0
changelog:
- section: Added
  entries:
  - Opt-in discovery of ad-hoc topic names and explicit topic creation/join results.
- section: Fixed
  entries:
  - Registration-independent diagnostics with versions and local compatibility recovery guidance.
  - Session lists omit gone sessions by default and retain explicit history filtering.
breaking: []
---
# kommutator 0.6.0 development preview

## Added

- `list_topics(discover: true)` finds ad-hoc topic names without joining them or exposing
  other projects, membership lists or board contents. `join_topic` reports `created` and
  `joined`; these describe mutations in this call, so both are false on a repeated join.

## Fixed

- `status` can inspect the daemon without session registration or starting it. Codex root
  metadata checks and fork rejection remain enforced.
- `setup_status` reports client/daemon versions, required/observed runtime contracts and
  local recovery guidance. Incompatible daemons need an explicit operator restart after
  active sessions end; diagnostics do not restart them or establish registration.
- `list_sessions` excludes gone sessions by default. Use `state: gone` for history.

Topic discovery, join result flags and session filtering require the updated hub; installing
only the client does not update the hub. Runtime contract remains 3 and no database migration
is needed. This maintenance task changes no live hub, daemon or client profiles.

## Validation

Build, typecheck and all 401 workspace tests passed on Node 24.22.1 / pnpm 10.18.0.
Independent code/security review, focused QA, generated pin verification and history/diff
secret scanning passed; artifact scanner matches were verified public license checksums.
`pnpm release:check` passed: dependency audit (no known vulnerabilities), 77 script tests,
fresh export integrity/licenses, both clean-PATH startup/setup smoke checks and synthetic
cross-vendor/recovery E2E. The optional external reviewer produced no parseable result
and was skipped.

## Not validated

Live reproduction on the reporting host, real vendor installation of this release,
macOS/ARM execution, Work UI/native idle wake, physical subnet clients, reboot/logon and
day-long operation remain open. Synthetic checks do not close these gates.
