# M1 step 7 operability checkpoint

Implementation and automated/process/browser checks passed on 2026-10-25. The full-day
real-use criterion in [MVP_PLAN step 7](../../MVP_PLAN.md#step-7--operability) remains open.
Follow [local operations](../../OPERATIONS.md) for commands and the acceptance record.

## Result

- `kom doctor` reports individual config/host, current PATH, GUI evidence, Claude/Codex
  hook structure, optional plugin structure, local IPC, registered Claude socket presence,
  and authenticated hub checks. It does not start the daemon, alter settings, execute hook
  commands or attempt vendor delivery. Per-check deadlines, HTTP redirect rejection and
  sanitized output bound the probes. It accepts explicit vendor-file/plugin paths and
  recognizes absolute executable paths. GUI launch and plugin activation are not inferred
  from shell PATH or files. Codex runtime support remains post-M1.
- `kom status` reports current daemon/hub health and outbox/session state. Historical
  errors retain timestamps after recovery without falsely keeping health degraded. An
  absent daemon produces actionable unavailable output and is never lazily started.
- `kom logs [--lines 0..10000] [-f]` prints raw complete JSONL, defaulting to the latest
  100 records within the last 4 MiB. It follows creation, append, rotation and truncation,
  preserves UTF-8 fragments until complete, bounds records to 64 KiB, handles backpressure,
  and exits on SIGINT/SIGTERM even with an undrained stdout pipe. Reads require a regular
  file and reject symlinks; no config/database access or daemon startup is involved.
- The dashboard adds recorded state/wake, session search/state/wake filters, feed-type
  filtering, loading/empty/no-matches/stale/disconnected states and last-successful-fetch
  time. Failed or invalidated snapshots retain old data visibly marked stale. Reconnect
  refreshes the snapshot; the API includes all live sessions and the latest 100 ended
  sessions. Existing authentication, safe text rendering and read-only behavior remain.

Production changes are in `packages/cli/src/{commands,doctor,logs}.ts`,
`packages/agentd/src/{core,daemon}.ts`, `packages/hub/src/api.ts` and
`packages/hub/public/index.html`. Their tests and DESIGN/PROTOCOL were updated.
The Codex template README now accurately identifies its post-M1 status and the limits of
structural doctor checks. No dependency or database schema changed.

## Verification

Node 24.19.0 / pnpm 10.18.0, from the repository root:

```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

All passed: **295 tests** — protocol 30, hub 141, agentd 49, CLI 75. Local socket/process
checks ran with permission to bind loopback TCP and Unix sockets. No lint script exists.
QA added a real authenticated HTTP response whose body stalls after headers; it verifies
that doctor returns within its deadline, aborts the response and closes IPC without leaking
credentials. Process tests also cover signal exit while multi-megabyte stdout is undrained.

Actual Chromium 151.0.7922.34 exercised production HTTP/SSE and the dashboard with fake
conformance sessions: initial loading, empty hub, all four states/wake/safe text/marked-read,
session filters/reset, feed filters, failed snapshot retaining rows/timestamp, retry
recovery, actual hub outage and SSE reopen recovering gap state. **Nine checks passed,
zero page errors.** See [JSON evidence](browser-qa.json),
[populated view](browser-populated.png) and [disconnected view](browser-disconnected.png).
The empty, stale and recovered screenshots are retained alongside them.

Built CLI/hub/daemon processes in a private temporary home passed **eight checks**:
absent-service diagnostics without side effects; authenticated hub without daemon;
healthy daemon with registered socket; missing/restored socket; rejected authentication;
outage status/log following; automatic recovery in the same daemon; unchanged settings and
zero vendor-socket connections. See [process evidence](process-qa.json). All owned processes
exited gracefully, temporary credentials were removed, and captured output contained none.
No real vendor process was needed for these checks.

Independent correctness and security reviewers approved; the dashboard review found one
minor freshness issue during an ordinary SSE invalidation, fixed and rechecked with a new
behavioral test. Log implementation QA also identified blocked-stdout signal handling,
fixed before the final review. The final aggregate is
[review-implementation-1.md](review-implementation-1.md). Browser/process driver errors
were corrected before the successful runs (fixture ID/path and asynchronous timing); no
product failure was reclassified as a pass.

## Remaining acceptance

A full day of actual coordination without opening SQLite manually has **not** been
observed. Record it using the operations guide before marking step 7 done. Actual GUI
inherited PATH/runtime support is explicitly unknown where no live evidence exists.
Previously accepted live M1 evidence remains in the step 6 checkpoint; this run makes no
new claim about Claude native wake or Codex integration.

The shared checkout had no Git repository. Repository step ordering takes precedence over
the skill's default worktree setup: implementation used bounded file ownership and a local
pre-change baseline for review. No Git initialization, commit, push, global hook/settings
installation or publishing occurred. Step 8 remains separate and the license is undecided.

Historical licensing note: earlier statements about an unchosen license describe their
dated checkpoint. MIT was selected for public preparation on 2026-10-29; see the root LICENSE.
