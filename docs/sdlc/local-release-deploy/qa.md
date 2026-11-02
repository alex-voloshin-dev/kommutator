# Local release deployment QA

Observed on 2026-11-02 in the isolated implementation checkout, Linux x64 / Node 24.
This QA used temporary homes/databases, fake GitHub/Docker command responses and real local
child processes. It did not operate the live Docker hub, daemon, updater service or releases.

## Added coverage

Five tests strengthen the deployment acceptance boundary:

- Import the actual built protocol and compare its exported release identity with package
  metadata, avoiding reliance on a nonexistent runtime-contract export.
- A newer in-progress CI run blocks deployment despite an older successful run for the same
  exact commit.
- Launch the actual updater wrapper in a private temporary HOME, then send SIGTERM. The
  signal reaches the active fake discovery command and its same-group descendant; both die.
- Either a newer running agentd or a newer running hub blocks a downgrade before image
  creation, backups, activation or daemon restart.
- Valid JSON on stdout remains parseable when stderr contains a harmless warning. The
  private command log retains both streams for diagnosis.

The existing suite also covers strict opt-in policy, release/asset selection, one-time applied
checkpoints, blocked crash/failure recovery, deployment isolation checks, backup ordering and
SQLite backup contents, abort handling, and survival of a successfully detached daemon.
The staged deployment fixture was adapted to provide the new actual-version preflight values.

## Executed checks

- `node --check scripts/local-release-deploy.test.mjs`: passed.
- `pnpm test:local-release-deploy`: 13 passed before the stderr regression was added.
- Final `pnpm test:local-release-deploy`: 14 passed, zero failures.
- `git diff --check`: passed.

The implementation engineer separately reported ordered build, typecheck and 393 workspace
tests. QA did not rerun those broad suites. The external review's stdout/stderr defect was
corrected by the engineer before the new regression executed; QA changed no production code.

## Gate and limits

QA gate: **pass for the tested candidate**. Actual Docker Compose normalization, access to
credentials/network, successful oneshot completion, the new daemon surviving service exit,
and verified live version/health remain coordinator-owned operational acceptance. A fake
Docker test does not establish these facts. Windows reboot, physical-subnet and day-long
acceptance remain separate.
