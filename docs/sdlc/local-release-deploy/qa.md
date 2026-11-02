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

## Round 3: private umask and preactivation image acceptance

The coordinator's live attempt found that the updater's private umask produced source files
with mode 0600. Docker COPY retained those permissions under root ownership, preventing the
non-root container from reading its entrypoint. The earlier fake Docker suite did not expose
this defect; its pass was not evidence of a deployable image.

QA added two regression cases after the engineer's correction:

- A real local Git repository is cloned by a child process with umask 0077. The test observes
  0600 regular files and 0700 executables, obtains actual tab/NUL-delimited Git stage records,
  and verifies normalization to 0644/0755. The private attempt parent remains 0700, Git
  metadata and untracked dependency content retain their modes, and a tracked symlink is
  rejected without changing the outside target's mode.
- A failed isolated non-root image smoke prevents backup, hub activation and daemon restart.
  The fake command boundary verifies no published host ports, bind mounts or real key/data
  paths, while retaining read-only execution, no external network and dropped capabilities.
  The successful-order test now requires image smoke between image build and backup.

The first focused run had three fixture failures because mocked Git records were empty;
fixtures were updated to supply the tracked package.json record expected by the new boundary.
No production assertion was weakened and QA edited no implementation source.
Final `pnpm test:local-release-deploy`: **16 passed, zero failures**. Syntax and diff checks
passed. Actual image startup, service activation and daemon survival still require the
coordinator's live validation; these test results do not claim that validation passed.
