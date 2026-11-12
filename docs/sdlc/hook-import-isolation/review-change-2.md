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
