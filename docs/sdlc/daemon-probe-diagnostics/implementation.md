# Daemon probe diagnostics

## Request and scope

The maintainer request is the implementation plan for this bounded observability change.
Preserve the existing daemon classification, compatibility behavior, lazy start and
all deadlines. Report only allowlisted local IPC diagnostic fields, and retain the
same failed invocation's result in exported E2E diagnostics before cleanup. No retry,
registration recovery, schema migration or service change is included.

`pluginDaemonDiagnostics` previously discarded `IpcError.diagnostic`. The unavailable
error retained its static recovery text but erased whether connection, hello or the
status request failed. The implementation projects a fixed method, bounded phase and
reason, and known code or null. Unknown and malformed input cannot supply arbitrary
error strings. The existing static error prefix remains unchanged; only a serialized
sanitized suffix is appended. The E2E parser accepts the exact prefix and bounded,
strictly shaped suffix, not arbitrary tool content, and makes no additional probe.
DESIGN section 19 and PROTOCOL describe the optional plugin-local field. Runtime IPC
schemas and the 5000 ms probe / 300 ms process / 140 ms entry / 90 ms hook budgets are
unchanged.

## Investigation evidence and limits

The original local 0.17.2 release gate failed at resumed owner-1 whoami in exported
E2E (`scripts/test-plugin-export-e2e.mjs:159`) after a 174 ms SessionStart. It returned
the generic shared-daemon-unavailable prefix. That identifies the daemon preflight,
not a completed Claude rebind, but does not identify its failing IPC phase or cause.
Published generation 2 and a successful hook exit do not prove IPC registration
completed. Exact-head hosted branch and PR CI passed; that does not explain this
local failure.

An initial copied-script/preload diagnostic was invalid for IPC timing attribution:
source matching missed bundled `id2` names. Its successful E2E result is not
qualification or evidence of complete instrumentation. The corrected bounded run
at 2026-11-25 16:14:01–16:14:33 UTC passed without reproducing the original failure.
It recorded 257 IPC sends, 255 resolutions and two expected rejections, no IPC timeout,
and one expected initial ENOENT connection failure. Twenty-four SQLite calls exceeded
20 ms; the longest was 236.561 ms. Instrumentation affects timing and request IDs
can overlap across connections, so no per-connection latency inference is claimed.
No production service or database was changed. The original failure cause remains
unknown; production storage observations do not establish this synthetic failure's
cause.

Diagnostic materials:
- `/tmp/kom-v0172-release-check.log`: original failed gate.
- `/tmp/kom-export-runtime-probe-invalid.mjs` and
  `/tmp/kom-export-runtime-probe-invalid.jsonl`: invalid instrumentation retained.
- `/tmp/kom-v0172-instrumented-e2e.log`: first instrumented run, not qualification.
- `/tmp/kom-export-runtime-probe.mjs`,
  `/tmp/kom-export-runtime-probe-corrected.jsonl`,
  `/tmp/kom-export-runtime-e2e-corrected.mjs`,
  `/tmp/kom-v0172-instrumented-e2e-corrected.log` and
  `/tmp/kom-v0172-probe-diagnostic-summary.json`: corrected non-reproduction.

## Verification

Independent frozen-lockfile dependencies were installed in this worktree. A baseline
control restored only the old production module while running the three new timeout
phase cases: all three failed because `probe_failure` was absent. Candidate source
was restored unchanged. This establishes the diagnostic loss, not the historical
failure cause.

The first focused candidate run had 24 passes and three failures: a test redaction
regex incorrectly matched the existing static words "private local configuration".
The assertion was narrowed to the injected secret/path; production behavior did not
change to satisfy it. The failed result is retained.

Final ordered build and typecheck passed, followed by 28 CLI probe tests and 16 script
diagnostic tests. Coverage includes all three timeout phases, real RPC rejection,
unknown/malformed/non-Error input, unknown codes, unchanged stopped and compatibility
classification, strict suffix parsing and rejection of extra fields/secret content.
No full workspace or release gate was run for this increment; integrated QA and CI
remain the maintainer's next gates.

Logs: `/tmp/kom-probe-install.log`, `/tmp/kom-probe-baseline.log`,
`/tmp/kom-probe-focused.log` (failed candidate assertion),
`/tmp/kom-probe-build2.log`, `/tmp/kom-probe-types2.log`,
`/tmp/kom-probe-focused2.log`, `/tmp/kom-probe-script2.log`.
