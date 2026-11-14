# Exported hook failure diagnostics

## Input and scope

Direct maintainer request during 0.16.0 qualification. Artifact home resolved to
`docs/sdlc/export-hook-diagnostics`; no prior plan or design existed for this small
repair. This change instruments only disposable exported-plugin test fixtures;
it does not alter production hooks, registration authority, replay, or receipts.

The third release gate timed out on owner-2 SessionStart after two seconds. Its
`birth_matches: false` diagnostic compared a `ps lstart` value with a canonical
Linux boot/start-ticks journal identity. That diagnostic mismatch is confirmed;
the timeout cause remains unknown.

## Implementation

- Import only the built agentd process helper, not the daemon/CLI entrypoint.
  Use the same canonical birth and comparison semantics as registration.
  Missing or incomparable identities return null, not an inferred mismatch.
- Record validated ISO wallclock start and bounded monotonic spawn, stdin-finish,
  close, and timeout phases. Missing phases remain null.
- Start one asynchronous best-effort Linux process sample at 1500 ms. Read at most
  the hook plus four descendants with bounded proc-file reads; verify process birth
  before and after sampling and descendant parentage. Emit synthetic labels,
  allowlisted process state/wait category/executable category, and safe scheduling
  counters only. Raw PID, birth, boot ID, command, environment, path and payload
  never enter the diagnostic output. Executable categories use comm conservatively;
  a shebang script may appear as `other` rather than its interpreter.
- The existing 2000 ms kill deadline never awaits the probe. It captures the latest
  completed sample or explicit pending/unavailable state. `sampled_at` and sample
  elapsed time denote the start of sampling, not an atomic state at timeout.
  Success cancels scheduled sampling and emits no process sample. In-flight reads
  settle with cancellation checks and handled rejections; reads are not forcibly
  interrupted. Non-Linux process sampling is explicitly unsupported.

## Evidence and verification

- Red: `/tmp/kom-export-diagnostics-birth-red.log`; a real running Linux owner
  journal returned false instead of true before the canonical-helper change.
- Green targeted: `/tmp/kom-export-diagnostics-targeted4.log`, 10/10 tests.
  Includes real match/different-process/legacy incomparable identities, timeout
  sampling, successful-hook cancellation, redaction, aborted probe and six-child
  traversal bounded to five emitted processes.
- Intermediate targeted run 2 failed because its test assumed a shebang script's
  comm was `node`; Linux retained its script name. The assertion now accepts the
  conservative `other` category. This was not a product timeout failure.
- Ordered workspace build, typecheck and test passed: 792 tests (41 protocol,
  208 hub, 249 agentd, 294 CLI). Logs: `/tmp/kom-export-diagnostics-build.log`,
  `/tmp/kom-export-diagnostics-typecheck.log`, `/tmp/kom-export-diagnostics-workspace.log`.
- The release-check script-test list passed 146/146, including the final diagnostic
  source. Log: `/tmp/kom-export-diagnostics-scripts.log`. Full packaging/exported
  E2E is owned by the release coordinator after independent review and QA.

## Limits

This improves evidence collection, not hook latency. The 2s fixture deadline and
production 140/90 ms timers are unchanged. Proc sampling is a bounded, non-atomic
observation and can be unavailable, incomplete or stale by timeout; it cannot
establish causality alone. No live runtime changes or exported E2E were performed
by this implementation task. Independent review/QA and an instrumented exported
E2E remain required before repeating the release qualification.

## Review round 1 revision

- Fixed a portability regression in the pre-existing owner fixture test: timing
  and timeout assertions run on every platform; Linux sample contents are asserted
  only on Linux, while other platforms explicitly require unsupported/empty data.
  No native macOS run was performed here.
- Added the observed `jbd2_log_wait_commit` wait symbol to a fixed `journal-wait`
  category. A focused redaction test verifies the category survives sanitization
  while raw/unknown kernel symbols cannot escape.
- Targeted diagnostic tests passed 11/11 on Linux:
  `/tmp/kom-export-diagnostics-review1-targeted.log`. Full ordered gates are deferred
  to independent QA after round 2 review, avoiding concurrent dist mutations.
