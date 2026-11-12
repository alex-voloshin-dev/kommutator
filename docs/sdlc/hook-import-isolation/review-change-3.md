---
type: review
target: hook-import-isolation-and-mcp-lifecycle
iteration: 3
verdict: approve
status: approved
review_decision: proceed
findings: []
---

# Final integrated review and qualification

Canonical hello extraction preserves the original schema byte-for-byte after
indentation normalization; built root/narrow exports share the same schema object.
Independent correctness/security review approved; the bundled-import regression
fails against the old build and passes against the candidate.

Fixture review found inconclusive process-birth handling and incomplete argv checks.
Both were corrected: uncertain live ownership preserves evidence and refuses signals;
termination requires matching birth, private home, executable and exact arguments.
A too-short newly introduced test cleanup bound was corrected to encompass the SDK's
two 2-second grace periods. Production hook timers remain unchanged.

A real-process baseline demonstrated the missing MCP stdin EOF cleanup. Review then
found resources could be created by in-flight handlers after the initial cleanup.
The final lifecycle fence rejects new work, checks after delayed resolution and
repeats idempotent cleanup after each admitted handler settles. Controlled tests
cover delayed setup creation, late client resources and a second unaffected MCP.
No daemon shutdown, message replay or explicit session retirement was introduced.
Internal reviewers approved the final correction. External review of the complete
integrated change approved without findings. An earlier excerpt omitted the shared
test helper and generated a false missing-file finding; the complete diff includes it.
A separate loader negative control failed during initialization and is excluded from
product evidence; the original no-EOF baseline is valid.

Final independent QA: one complete release:check passed frozen install/audit/catalogs,
ordered build/typecheck, 584 workspace tests, 140 script tests, export verification,
both clean-PATH smokes and all synthetic E2E scenarios. Earlier failures below remain
unresolved evidence; this pass does not establish the original #9/#19 trigger.
Source/history scans passed; export manifest matches are verified payload hashes.
No live model, Work/native wake, other-platform, physical-subnet, unattended-reboot
or day-long acceptance is claimed.

## Preserved earlier rounds and qualification failures

# Hook import isolation review

2026-11-12. Assumption: remove independently proven unnecessary hook dependencies;
do not claim to explain historical #9 latency or #19 registration failures.

The existing /paths export exposes the exact same pathsFor implementation. The
IPC client previously pulled the agentd barrel and its ws/SQLite modules into
every hook. No timer, protocol, identity, receipt, replay or daemon behavior changes.

Independent correctness/security review approves with no findings. The baseline
resolver-denial regression fails despite exit 0; the candidate requires visible
output and exact ACK IDs without ws/node:sqlite imports. Workspace build/typecheck
and 8 focused tests passed. Bundled ws can evade specifier detection; static module
graph inspection complements this source-process regression.

Bounded A/B measurements and their fixture interruption are retained in
spikes/RESULTS.md and sanitized JSON. The unchanged-base #19 reproduction sample
passed 40 tests; it does not resolve the original failure. No speculative registration
change was made. External review and full QA results follow after completion.

Final evidence/catalog review approved: all 78 unique samples, their 59+19 split,
reported medians and six traced plugin authority/deadline outcomes were recomputed.
Versioned catalog URLs/pins match the generated 0.12.4 sidecars.
External review approved with one minor finding: accepted sockets in the new test
needed error containment. The fixture now records bounded socket error codes and
asserts no errors; failures are not silently ignored. Production code is unchanged.

## First full qualification — blocked

One full release:check passed frozen install/audit/catalog checks, ordered build
and typecheck, 573 workspace tests and 134 script tests, export verification and
both clean-PATH smokes. Exported E2E then failed at its first Claude owner's
initial whoami (scripts/test-plugin-export-e2e.mjs:107): root registration
unavailable or expired, after both cold SessionStart hooks. No rerun was requested.
The wrapper checked only fail-open exit/output; cleanup removed its authority
state. The failing publication/probe stage is unknown. This is distinct evidence
from the manual lifecycle fixture #19, not proof of their shared cause.
Release remains unqualified until this failure is investigated.

## Diagnostic hardening before qualification round 2

Added failure-only exported E2E snapshots with owner-labelled stages, bounded
hook timing/exit/byte counts and authority comparisons. No raw output, hello,
credentials or paths are emitted. Successful runs do not reread authority.
Existing hook/fixture timers, assertions and one-attempt behavior remain intact.
Six focused diagnostic tests pass; independent correctness/security review approves.
The first new helper test exposed uncaught owner stdin EPIPE from an immediate-exit
stub. A direct reproduction confirmed that fixture defect. The stub now consumes
stdin, and a separate closed-stdin large-payload case verifies bounded EPIPE
classification without process crash. This does not explain the first-whoami failure.

External diagnostic review approved with one minor lifecycle finding: stdin
failure cleared the watchdog while a child could remain alive. The fixture now
captures its safe diagnostic and SIGKILLs only that disposable child before
rejecting. The controlled child closes stdin and stays alive; the test verifies
it is gone after the error. Six focused tests passed again after this change.
No production lifecycle behavior changed.

## Qualification round 2 — passed

After the diagnostic/fixture corrections, independent QA ran one complete
release:check: frozen install/audit/catalog checks, ordered build/typecheck,
573 workspace tests (protocol38, hub176, agentd118, CLI241), 140 script tests,
export verification, both clean-PATH smokes and synthetic exported E2E passed.
No further reruns. This success does not resolve the first qualification failure;
its original cause remains unknown and #19 stays open.
Source and history secret scans passed; two export-manifest scanner matches were
payload digests, with all 191 files per vendor independently verified.



# Observation contract correction — round 1

Independent correctness/integration review and the external CLI lens approved
without findings. Eight focused tests passed. The process rejection test preserves
exact hello-only IPC, fail-open output, absent hub registration and no false
success. A separate deterministic real hook/storage test requires final failure
persistence without the independent entrypoint deadline.

QA: one full 0.12.5 release check failed a different semantic SessionEnd assertion
(573 workspace passed, one failed). Original cause unknown. Build/typecheck
passed; script/export stages were not reached. No release or deployment.
See observation-contract-correction.md and spikes/RESULTS.md. Gate remains red.



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
