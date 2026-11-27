---
type: qa
feature: project-context-recovery
status: passed-with-retained-failures
date: 2026-11-27
implementation: cfb1a53
---

# Independent QA

QA read the approved design, implementation, repository contracts, QA role and engineering/
TypeScript standards. Test changes were authorized after the parent reported internal
correctness/security and external round-2 approval of `cfb1a53`. No implementation code,
version, installed runtime or live configuration was changed by QA.

## Added coverage

- `packages/cli/test/project-context.test.ts`: two built-process cases exercise actual CLI
  dispatch and flags for preview, explicit apply, missing/stale revision rejection and
  deleted-checkout removal; verify no runtime state and sanitized preview output. A built
  `daemon run` process rejects malformed selections before creating socket/database/info.
- `packages/agentd/test/project-contexts.test.ts`: two cases accept exactly 128 records and
  64 KiB, reject a 129th record without replacing valid state and reject the next byte.
  Foreign file-descriptor ownership is tested with a synthetic caller UID after the actual
  directory descriptor check, without privileged chown; real unsafe-directory permissions
  and a symlinked private directory reject reads/writes and preserve the target contents.
- `packages/agentd/test/daemon-core.test.ts`: the existing real-hub dispatcher/database
  fixture now holds divergent content for the same board key in canonical and legacy
  namespaces. Both complete boards/histories remain equal after selection/restart/lifecycle
  controls; membership denial holds in both directions. The fixture uses in-process
  transport, not live vendors or a deployed socket path.

Existing coverage already includes changed/missing mapped origin, Codex independent-root
activation versus resume/reload, generation fences, stale-owner asynchronous probes,
shutdown controls, deleted-cwd removal, record CAS and retained/replaced writer locks.
Four new tests were added and one existing test strengthened; no tests were weakened,
skipped, removed or given a larger pre-existing timeout.

## Executed validation and retained failures

Observed toolchain: Node `v26.13.0`, pnpm `12.18.0`. Existing installation was used.
All times below are UTC on 2026-11-27; Vitest logs display America/New_York (UTC-5).

1. Ordered build and typecheck passed:
   `/tmp/kom-nov27-project-qa-build.log`,
   `/tmp/kom-nov27-project-qa-typecheck.log`.
2. First full workspace tests **failed**, log `/tmp/kom-nov27-project-qa-test.log`.
   Protocol began 18:32:36, 41 passed; hub began 18:32:37, 209 passed; agentd began
   18:32:44, 302 passed and 3 failed (14.30 s). All failures were the unchanged 5000 ms
   test deadline, in:
   - `registry-migration.test.ts`: upgrades schema 2 conservatively and persists retirement
     reasons through reopen;
   - `operations.test.ts`: attaches registration once after offline admission and survives
     a same-owner daemon restart;
   - strengthened `daemon-core.test.ts`: retains legacy persisted Claude and Codex contexts
     after restart while selecting new seats and preserving real board history.
   Total completed: **552 passed, 3 failed**. Recursive execution stopped before CLI.
3. Focused diagnostics, without code/timeout changes: agentd four files **218 passed**,
   began 18:33:21, 5.44 s (`/tmp/kom-nov27-project-qa-focused-agentd.log`); CLI project-context
   **4 passed**, began 18:33:33, 1.92 s (`/tmp/kom-nov27-project-qa-focused-cli.log`).
4. One complete ordered qualification repeat passed: build, then typecheck, then full
   workspace tests. Logs `/tmp/kom-nov27-project-qa-build2.log`,
   `/tmp/kom-nov27-project-qa-typecheck2.log`, `/tmp/kom-nov27-project-qa-test2.log`.
   **916 tests / 75 files passed**: protocol 41 (18:34:05), hub 209 (18:34:06),
   agentd 305 (18:34:09), CLI 361 (18:34:17, 58.39 s). No further heavy retries.
5. `git diff --check` passed.

The initial timeout causes remain unknown. Later passing diagnostics and qualification
neither explain nor erase those failures. No storage or implementation cause is inferred.
The parent captured separate host observations; QA did not independently collect them.

## Remaining gates and limits

`pnpm release:check`, versioned packaging/export, hosted qualification and live activation
remain parent-owned work; QA did not run release checks. No live board access or vendor
activation was performed. Day-long use, physical subnet and reboot gates remain open.
Foreign ownership coverage uses synthetic UID evidence, not an actual foreign-owned inode;
no deterministic pathname replacement race or successful built-daemon mapped-registration
process test was added. Existing startup loader/in-process registration coverage and the new
built invalid-startup case do not constitute a live activation claim.
