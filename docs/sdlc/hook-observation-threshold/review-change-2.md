# Temporary hook observation threshold

User-requested small change, 2026-11-11. Assumption: raise only full-process test acceptance
from less than 200 ms to less than 300 ms while observing CI; keep runtime behavior unchanged.

## Review

Round 1: internal reviewer approved correctness and contract consistency. External reviewer
approved with no findings. No input, authentication, secret, dependency or protocol changes.
One internal minor finding: capture timing before exit/result assertions in the Stop IPC and
hosted-launcher tests, so assertion overhead does not enter the measured duration.

The 140 ms entrypoint timer and 90 ms IPC timeout remain unchanged. Test-only diagnostics
report measured duration, original 200 ms target, temporary 300 ms gate and above-target flag.
Issue #9 stays open: a more permissive gate is not a root-cause fix. Historical evidence is
not rewritten, and runtime services do not need a release or restart for this test policy.

## Final refinement

The minor finding was fixed by capturing elapsed time immediately after completion, before
assertions. Initial QA passed all 520 workspace and 12 hosted-launcher tests, but discovered
Vitest's default reporter hid passing-test measurements. The CLI test command now explicitly
uses `--silent=false`; a focused package-command run confirmed visible measurements.
Round 2 internal review approved with no findings. These changes remain test-only.

## Validation and handoff

Final external review: approve, no findings. QA: approve. Required build → typecheck →
workspace tests passed in order (520 tests); hosted-launcher tests passed (12).
The normal workspace test command printed all ten CLI timing observations: 121.314–190.361 ms;
configured cold SessionStart was 142.752 ms. Hosted cold launcher: 2.224 ms. None exceeded
200 ms in this local run; these observations do not establish a CI latency fix.
Review decision: proceed at iteration 2. No runtime release, service restart or schema change.
