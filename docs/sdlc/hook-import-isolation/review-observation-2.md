---
type: review
target: hook-import-isolation-observation-contract
iteration: 2
verdict: approve
status: draft
review_decision: revise
findings: []
---

# Observation correction and retirement diagnostics — round 2

Independent correctness/security review and external CLI review approved the
failure-only retirement snapshot without findings. It emits bounded generation,
ended-marker and identity-comparison booleans before cleanup when whoami wrongly
succeeds; it does not emit stored IDs, paths, replies or credentials. It leaves
successful-path timing and the semantic assertion unchanged.

One focused diagnostic passed (one test, five skipped), without reproducing the
first full qualification's semantic failure. Successful console evidence was
suppressed by Vitest; no new phase timings are claimed. The original cause
remains unknown. A second complete qualification runs only after this reviewed
diagnostic addition, not as a retry of the unchanged failed candidate.

The original rejection-test correction was approved by internal and external
reviewers and passed eight focused tests; see round 1 for the first full failure.

## Second complete qualification — failed

572 workspace tests passed, two failed. The previously failing stalled-observation
retirement scenario passed (SessionEnd 187.984 ms), but B-to-A-to-B returned A
after the final B hook. Captured journals remained generation 1 B and generation
2 A; final SessionStart elapsed 230.683 ms and did not publish generation 3. An
earlier repeated B hook also left generation 1 unchanged. This identifies missing
publication, not its cause. The separate delayed-delivery retirement fixture
reported a daemon IPC timeout; its stack does not prove which operation or cleanup
stage caused it. Build/typecheck passed; scripts/export were not reached.

No further full qualification retry is authorized without new diagnostic evidence
or a reviewed correction. Candidate remains unqualified and unpublished.

One corrected phase diagnostic published all four generations before the deadline
but ended with an unlabelled IPC timeout. The earlier instrumentation run changed
Node promisify semantics and is excluded from product evidence. No runtime fix
was justified. Review-decision returned `revise`; this is a blocked draft handoff,
not a merge-ready change. See RESULTS for timing limits and next diagnostic scope.
