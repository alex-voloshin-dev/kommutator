# Dependency refresh: approved scope and checkpoints

## Assumptions

The operator approved the dependency review on 2026-11-11 and explicitly retained
Node 26 / pnpm 12 as a subsequent phase after the other upgrades. The request is the
implementation plan; no separate PRD or technical design is needed for these scoped
dependency updates. This branch is based on the reviewed feedback fixes in PR #5
(`232b73f`) so the combined runtime and packaging behavior can be tested.

The current change retains Node 24 and matching Node 24 type declarations. It does not
upgrade the host's global tools, change vendor installations, publish a release or restart
live hub/daemon processes. A separate runtime-toolchain-refresh plan owns Node 26, pnpm 12 and their rollout.
That local plan remains in review: the cutover updater needs an enforced expected
version/commit constraint before the migration can proceed.

## Implementation checkpoints

1. Update `ws` to 8.22.2 and pin pnpm 10.34.9 consistently in contributor instructions,
   manifests, Docker, CI and executable release/deployment checks. Preserve frozen installs.
2. Update `citty` to 0.2.2 and Vitest to 5.1.0; preserve meaningful CLI behavior and all
   test assertions. Fix compatibility issues instead of weakening gates.
3. Update TypeScript to 7.0.2 with the TypeScript 6 compiler-API compatibility package
   required by tsup declaration generation. Preserve emitted ESM import paths and builtin
   `node:sqlite`; exercise both type checking and `.d.ts` generation.
4. Independently review correctness, integration and dependency/security changes, then QA.
   Run build, typecheck and test in that order, dependency audit and the complete release
   qualification including exported plugin smoke and synthetic E2E.

MCP SDK, Zod, tsup and `@types/ws` were already current at inspection and are not bumped
merely to change the lockfile. Node 26 types must not be applied to the Node 24 runtime.
Historical acceptance reports retain the versions actually tested at that time.

## Validation and limitations

Phase 1 passed ordered workspace build, typecheck and all 518 tests on Node 24.22.2,
pnpm 10.34.9 and `ws` 8.22.2. The host's global package-manager pin was not replaced.
The updater's exact source package-manager gate and fixtures were synchronized too;
an older installed updater must be deliberately refreshed before it can accept a future
release with the new package-manager identity.

Phases 2 and 3 also passed ordered build, typecheck and all 518 tests. The final checker is
TypeScript 7.0.2 (`pnpm exec tsc --version`); `typescript` is an npm alias for
`@typescript/typescript6` 6.0.2, whose compiler API is 6.0.3. The separate
`@typescript/native` alias supplies TypeScript 7's `tsc` executable. tsup declaration
generation uses the compatibility API. A plain TypeScript 7 installation failed because
tsup's own configuration parser also requires that API; no vendor files or dependency
overrides were retained to work around it. CONTRIBUTING documents the supported aliases.

Frozen installation, 16 updater tests and vault validation passed. `pnpm audit` reported
zero known advisories across 238 dependencies after the update. Independent correctness
and dependency/security reviews approved the implementation; the operator runbook now
documents the old updater's required transition before the first new-pin release.

Final release qualification passed: ordered build/typecheck, 520 workspace tests,
116 script tests, export checksums/license verification, both exported plugin smoke checks
and synthetic cross-vendor E2E. QA added two no-hooks process regression cases. Gitleaks
found no secrets in the candidate diff.

The Docker image kommutator-dependency-refresh:qa built successfully and passed the
isolated non-root authenticated hub smoke using synthetic credentials, no external network
and temporary storage. Its observed runtime is Node 24.22.2. This does not establish
production persistence or live vendor behavior. No deployment is claimed.
Release qualification does not establish real-vendor loaded-host behavior, other-platform
plugin execution, physical-subnet access or day-long reliability.
