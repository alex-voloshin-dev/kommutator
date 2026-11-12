---
type: review
target: pending-registration
iteration: 2
verdict: approve
status: approved
review_decision: proceed
findings: []
---

# Pending registration review

Assumption: fix the demonstrated accepted-registration/initial-binding race without
claiming the historical CI trigger established. Runtime recovery is limited to an
unbound manual Claude shim and already accepted matching hook tickets. No schema,
receipt, replay or hook-deadline change.

Independent correctness/security review approved the final core after resolving:

1. Initial process-birth probes completing after close/disconnect could touch closed
   state or install a waiter too late. Post-probe and continuation fences were added.
2. ipc.hello swallowed cancellation as an ordinary binding error. Explicit open/peer
   checks before and after flush now reject shutdown/disconnect.

The initial external review approved the earlier complete diff. Final integrated
external review and independent QA are pending. An escaping finding was withdrawn
following byte-level verification; it was a tool-rendering false positive.

The initial traced sample failed because esbuild renamed record to record2; the
local-save anchor was corrected and both traced cases passed. Later core shutdown
checks changed the flush anchor; it was scoped to the hello branch and awaits final
smoke. Instrumentation validates inserted anchors, not whether every phase executes:
a genuine failure may stop before local save. withCleanup retains the original
assertion if cleanup diagnostics also fail.

Final decisions and qualification evidence will be recorded before publication.


QA environment correction: an attempted baseline negative control used shared
node_modules symlinks. pnpm workspace resolution rewrote candidate dependency links
before any baseline test executed. That control is invalid, not a product failure.
The first 0.12.6 export/assets are quarantined with `-invalid-shared-deps` suffixes
and must not be published. Candidate links were restored with frozen install and
verified to resolve under its own packages; the baseline now has an independent
install. Ordered qualification and packaging must be repeated after restoration.
The earlier 603-test pass preceded this setup error and is retained, not used to
qualify potentially affected artifacts.


Independent QA added a fixed-snapshot case ensuring a later ticket cannot extend
waiting. Old 0.12.5 core in a genuinely isolated install failed the new success
regression cleanly; candidate 0.12.6 passed the original real-process 200 ms delayed
registration control without a new hook or whoami retry. Deferred-test cleanup was
hardened after the first negative control exposed an unobserved rejection; the clean
control retained the semantic failure without cleanup noise. Reviewer approved.

Post-restoration build/typecheck passed, but the workspace gate passed 601/603:
rejected-hook expected one hello and saw none; configured cold SessionStart took
375.141 ms against the unchanged 300 ms cap. These untraced failures are retained;
no cause is assigned and no assertion/timer was relaxed. A targeted traced cold
sample passed in 181.073 ms, a predefined 16-case diagnostic series passed with a
157.670 ms maximum, and the full instrumented CLI run passed 251/251. This is
additional evidence, not proof that #9 or the earlier failures are fixed.

The phase loader now includes delivery import/run/stdin boundaries and parent
start/close timestamps. Its core-anchor assertion applies only when the fixture
actually started a daemon (the rejected-IPC fixture uses a synthetic listener).
Final release qualification will run once on the final reviewed diagnostic/test
changes after fresh artifact generation. Both old assets remain quarantined.


## Final decision

Final integrated external review approved without findings. Independent review
approved the final QA cleanup and trace-only deltas. The final release:check passed
603 workspace tests (39 protocol, 176 hub, 137 agentd, 251 CLI), 140 script tests,
ordered build/typecheck, export/checksum verification, both clean-PATH plugin smokes
and all synthetic exported E2E scenarios. Log:
`/tmp/kommutator-v0126-final-release-check.log`.

Decision: proceed with this bounded registration fix and observed qualification.
Do not close #9 or claim all historical #19 causes resolved. Earlier qualification
failures and invalid control setup remain explicit above. No retries of failed CI,
raised timer/threshold, registration replay or weakened identity assertion were used.
