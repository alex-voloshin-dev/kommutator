---
type: release
feature: plugin-doctor
status: approved
version: 0.4.0
changelog:
- section: Added
  entries:
  - add opt-in autonomous feedback maintainer
- section: Fixed
  entries:
  - use compatible automatic-review worker flags
  - recognize bundled doctor invocations and name daemon help commands
breaking: []
---
# kommutator 0.4.0 development preview

## Added

- Opt-in operator-authorized feedback maintenance with isolated workers and durable reports.

## Fixed

- Compatible automatic-review worker flags.
- Bundled plugin doctor invocations no longer require a global `kom` or recommend duplicate manual hooks. Vendor activation remains unverified; broken configured integrations and runtime failures remain visible.
- Daemon lifecycle help uses command names instead of an internal runtime script path.

Runtime contract remains 3. This release does not restart or update any live service.
The canonical maintainer topic remains `kommutator feedback` (space). The reported
hyphenated topic was not inspected or aliased; live topic changes are outside this clone-only task.

## Validation

Node 24.22.1 / pnpm 10.18.0 on Linux x64: ordered build, typecheck and all 393
workspace tests passed. `pnpm release:check` passed, including dependency audit (no known
vulnerabilities), 60 script tests, fresh export integrity/licenses, clean-PATH MCP/setup
smoke and configured synthetic cross-vendor/recovery E2E. Exact release exports also passed
`bin/manage` daemon-help and plugin-aware doctor checks in isolated homes.
Independent code/security review and QA approved; the optional external reviewer returned
no parseable result and was skipped. Source and full-history Gitleaks found no secrets;
two artifact detector hits were verified as public dependency license SHA-256 values.

The release gate exposed and fixed one pre-existing test fixture's umask dependence;
its unchanged-target permission assertion remains intact. Earlier sandbox restrictions and
transient test timeouts are recorded in the review artifact, not counted as passes.

## Not validated

Interactive vendor sessions on the reporting host, actual plugin hook trust/activation,
macOS/ARM bundles, Work UI/native idle wake, reboot/logon, physical subnet boundaries,
and day-long operation remain open. Synthetic tests cannot establish these gates.
