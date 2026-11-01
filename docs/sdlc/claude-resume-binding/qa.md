# Claude resume binding QA

Observed on 2026-11-01, Linux x64 / WSL, Node 24. Tests use private temporary homes,
synthetic vendor processes and an isolated production hub. They do not use operator
credentials or modify running hub/client configuration.

## Added coverage

- `packages/cli/test/claude-resume-process.test.ts` drives the built CLI over the real
  MCP SDK stdio transport. A process whose immutable launch ID is A accepts a later
  SessionStart for B, then follows B → A → B without restarting MCP. It verifies
  separate identities/status, previous-conversation retirement, delayed SessionEnd
  isolation, final retirement, and setup configuration remaining distinct from binding.
- A second process test corrupts and removes active registration authority while a
  valid legacy registration remains. Calls fail closed rather than selecting that
  legacy identity; restoration is a positive control.
- The exported-plugin harness retains its two-process same-vendor-ID isolation tests
  and adds A → B → A on one unchanged MCP PID/launch environment. Another owner of A
  must remain unaffected. It also exercises MCP startup before a hook registers a
  different conversation and rejects calls after that conversation ends.

## Executed checks

The initial full-suite run and first focused process run exposed intermittent missing
registration or missing SessionEnd effects. These were not treated as passing results
or hidden with retries. A subsequent diagnostic run and three sequential isolated runs
passed 2/2. The engineer then fixed a separately verified captured-generation SessionEnd
race and reduced redundant probes; no hook deadline was increased.

The final engineer build/typecheck/full-test logs were inspected by QA: all four builds
and typechecks passed, followed by 33 protocol + 141 hub + 72 daemon + 139 CLI tests
(385 total). This includes the final two QA process tests and the schema-1 migration
test preserving session, pending replay and delivery records before saving/reopening
a generation fence in schema 2. Those full-suite commands were run by the engineer,
not independently rerun by QA at that checkpoint.

QA independently verified the preserved published export's version as 0.2.2 and ran
the expanded artifact harness against it. The negative control reproduced the defect:
after SessionStart B, the unchanged MCP returned vendor ID A instead of B. The test
failed at that exact identity assertion, and its private fixture cleaned up.

JavaScript syntax checks for both modified artifact scripts and `git diff --check`
passed.

The first 0.3.0 candidate failed qualification. Integrity verification passed, but the
smoke test found that the manifest was 0.3.0 while compiled MCP code still reported
0.2.2: packaging had occurred before rebuilding after the version bump. The E2E run
passed the new resume scenarios, then found a separate regression in the existing
same-owner repeated-SessionStart stability assertion: a second SessionStart for the
already active conversation unnecessarily increased incarnation. Neither failure was
waived. The latter now also has a fast process-test assertion. A rebuilt candidate and
the runtime correction must pass before QA approval.

After the incarnation correction, a parallel CLI run again intermittently missed a
registration. Temporary opt-in diagnostics then captured the cause: module imports
consumed roughly 79–110 ms and context persistence another 17–42 ms; several hooks hit
the unchanged 140 ms internal deadline before IPC completed. The new process cases
passed in that diagnostic run, while an existing manual-session lifecycle case failed.
This was resource contention between test files, not evidence that increasing hook
deadlines or retrying until green would be an acceptable fix. Temporary diagnostic
code was removed.

## Final candidate result: pass

CLI test files now run sequentially so independently spawned deadline-sensitive hook
processes do not compete across unrelated suites. Explicit concurrent-owner and
concurrent-call scenarios remain in the tests, and neither hook deadlines nor timing
assertions were relaxed. The engineer's clean final build/typecheck/test logs were
inspected: all builds and typechecks passed, followed by 33 protocol + 141 hub +
73 daemon + 139 CLI tests (386 total). The added daemon assertion and QA process
assertion preserve identity/incarnation on repeated SessionStart for the active vendor ID.

QA then independently ran these commands sequentially on the fresh, fully rebuilt
0.3.0 Linux x64 export:

- `verify-plugin-export.mjs`: checksums, release identities and licenses passed.
- `smoke-plugin-export.mjs`: both Claude and Codex initialized with a clean PATH,
  advertised the correct 0.3.0 version, served private setup, and survived cache removal.
- `test-plugin-export-e2e.mjs`: all scenarios passed, including stale launch IDs,
  unchanged MCP PID across A → B → A, retirement and late-hook rejection, concurrent
  same-ID owner isolation, repeated SessionStart stability, cross-vendor messaging,
  topic/board operations, cache removal, daemon restart and offline queued send.

The earlier invalid candidate was not reused or approved. Final artifacts were checked
without overlapping builds or test suites. This QA gate approves the tested candidate;
the integrating maintainer's complete release gate and publication checks remain separate.

## Remaining evidence boundary

Synthetic stdio/process/artifact tests do not establish actual Claude UI resume or
native wake after resume. The user's second machine, macOS bundles, Windows reboot,
external physical subnet filtering and day-long availability remain separate gates.
