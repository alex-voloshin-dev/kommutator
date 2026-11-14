# Exported hook diagnostics — independent QA

Date: 2026-11-14. Reviewed implementation `a8a23683ee6ddc6601dafd5336a5cb5f9ff3d738`,
then the narrowly corrected Node classification in
`db5664d95375392d6076fb49673e25b7b03dd348`. QA changed only tests and this report.
No production services, MCP sessions, configuration, packaging or release state changed.

## Added coverage

- The actual owner fixture runs with a diagnostic probe replaced at the module
  boundary by either a never-settling promise or a rejected promise. Both retain
  the existing two-second timeout, kill their hook, and emit only pending/unavailable
  metadata; private rejection text does not reach IPC or stderr. No production
  implementation was copied or modified for this test.
- An isolated child overrides its platform to exercise the non-Linux unsupported
  path before attempting process inspection. This is a branch simulation, not a
  native macOS run.
- The real Linux sampler verifies that an actual known Node process is categorized
  as node. Existing shebang-hook assertions still permit other, because Linux can
  retain the script name rather than the interpreter name.

Existing canonical birth match/mismatch/incomparable, redaction, timestamp,
wait-category, cancellation and bounded descendant tests were retained unchanged
except for the additional real Node assertion.

## Finding and correction

A direct QA probe on the pinned Node 26 runtime observed comm=node-MainThread but
executable=other. This was a conservative diagnostic fallback, not an authority
error, but lost the desired Node/bootstrap distinction. The implementation engineer
added only the exact Node name to the fixed classifier in db5664d. The new assertion
ran after that commit and passed; QA does not claim a pre-fix failing assertion run.
The preceding direct observation, rather than a reconstructed red run, supports the
finding. No other implementation defect was found by these QA cases.

## Executed gates

Pinned Node 26.13.0 and pnpm 12.18.0. All commands ran serially with exclusive build
access. No deadlines, internal hook timers, existing assertions or failure outcomes
were relaxed.

- Initial targeted additions: 15/15 passed,
  `/tmp/kom-export-diagnostics-qa-targeted.log`. Pending/rejected probe cases took
  2075/2089 ms including fixture startup and cleanup, with timeout phases near 2s.
- Final targeted diagnostics: 15/15 passed,
  `/tmp/kom-export-diagnostics-qa-targeted-final.log`.
- Then `pnpm -r build`: exit 0,
  `/tmp/kom-export-diagnostics-qa-build.log`.
- Then `pnpm -r typecheck`: exit 0,
  `/tmp/kom-export-diagnostics-qa-typecheck.log`.
- Then `pnpm -r test`: 792/792 passed (41 protocol, 208 hub, 249 agentd, 294 CLI),
  `/tmp/kom-export-diagnostics-qa-workspace.log`.
- Then the exact script-test list from release-check.mjs: 151/151 passed,
  `/tmp/kom-export-diagnostics-qa-scripts.log`.
- `git diff --check`: passed.

No executed QA check failed in this scope. The earlier canonical-birth red test and
review findings are recorded in implementation.md; QA did not rerun those historical
commands. The original qualification failures remain unresolved causal evidence.

## Remaining limits

The sampler is best-effort and non-atomic; an observation before timeout is not a
snapshot at timeout. Simulated non-Linux behavior does not validate native macOS.
These gates do not prove real vendor wake, day-long operation, reboot/subnet
acceptance, or the cause of the previous exported-hook timeout. Full packaging,
exact-head CI, public installation and rollout remain the release coordinator's
subsequent gates.
