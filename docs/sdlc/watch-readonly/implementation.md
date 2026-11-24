# Read-only cached management and watch permission diagnostics

## Scope and assumptions

Feedback #454 (`251e330b-d013-4958-ad56-801080617466`) reported that Codex
workspace-write could use MCP but `bin/launch manage watch --help` failed while
chmodding the private state directory. Calling the bundled management entrypoint
instead produced only the generic watch error. The user requested feedback processing;
this bounded task uses that request as its plan.

The two failures are distinct. A cached launcher should not require installation writes
for management help. A command still requires authorized local Unix socket access to
watch; a working MCP process does not establish shell sandbox access. The report's exact
sandbox errno is unknown, so the added allowlisted guidance is not a claim that every
reported direct-watch failure was EACCES.

## Change

- Hosted `manage` with a ready immutable cache validates canonical paths, non-symlink
  directories, exact owner/private modes and the ready digest, then executes management
  without mkdir/chmod/download or an installation lock. An insecure cache is rejected;
  the warm path does not repair or relax permissions.
- Cold management installation, MCP startup and hooks retain their existing paths.
  Installation remains atomic: the target appears only after the completed staged
  directory is renamed. Warm management never reads an incomplete staged installation.
- Watch maps only local EACCES, EPERM and EROFS codes to fixed actionable IPC guidance.
  It never reflects arbitrary error text, retries permission failures, registers,
  acknowledges messages or changes membership. IPC authorization is unchanged.
- Neither implementation promises protection against the owning user maliciously
  replacing their own executable cache; the existing same-user trust boundary remains.

## Verification — 2026-11-24

Baseline on c155592:
- New hosted process regression failed because the warm path attempted a filesystem
  operation (exit 73 under deterministic denied-operation wrappers).
- New watch regression failed: EACCES returned the old generic error rather than
  bounded local-permission guidance.

Candidate:
- Independent frozen-lockfile dependency installation; Node 26.13.0 / pnpm 12.18.0.
- `pnpm -r build`, then `pnpm -r typecheck`: passed.
- Focused CLI watch: 5 passed.
- Hosted launcher plus runtime bootstrap: 21 passed (includes 5 nested hostile-cache
  cases). Final hosted rerun after adding a FIFO lock: 19 passed, no skips.
- Warm management rejects wrong ready digest, linked ready/bundle/target/cache paths
  and insecure home permissions. Existing tests retain cold FIFO/lock rejection,
  target permissions and atomic concurrent first-install checks. Warm management does
  not open even a FIFO installation lock.
- Actual exported candidate bundle initialized in a private fixture. With the entire
  filesystem read-only under bubblewrap and a private `/dev`, baseline launcher failed
  at chmod with EROFS; candidate `manage watch --help` exited 0 with normal help output.
  Both used the same initialized bundle and cache. This checks the actual nested
  bootstrap, not only a mock executable.
- Actual exported `manage watch` against a private test socket chmodded 000 exited 1,
  emitted fixed EACCES guidance, and emitted no stdout. No live daemon was contacted.

The first bubblewrap probe mistakenly made `/dev/null` inaccessible; both launchers
failed before the target behavior. It is invalid fixture setup, retained separately,
not a successful qualification run. Corrected probe adds private `--dev /dev`.

Full workspace and release qualification, independent review and QA remain the
integrating maintainer's gates. No service, real permission, plugin installation,
credential, hub state or release was changed. These tests do not prove actual Codex
workspace-write Unix socket access or native wake.

Local logs: `/tmp/kom-watch-{launch-baseline,ipc-baseline,build,typecheck,tests,script-tests,hosted-final}.log`;
process observations `/tmp/kom-watch-readonly-probe.json` (invalid mount plus socket test)
and `/tmp/kom-watch-readonly-probe-round2.json` (corrected read-only mount).
