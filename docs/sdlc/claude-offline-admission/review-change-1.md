---
type: review
target: "Claude offline tracked admission worktree diff against origin/main c155592"
iteration: 1
verdict: approve
findings: []
---

# Independent correctness and security review

Reviewed the current uncommitted source change in `packages/cli/src/claude.ts`,
new `packages/cli/test/claude-offline.test.ts`, and DESIGN §19 / PROTOCOL additions.
Read the original wrapper, daemon binding/ownership/operation admission, IPC connection
preparation, plugin preparation, existing Claude resume tests, and prior operation
recovery implementation. No code was changed and no tests/builds were run by this lens.

## Verdict

Approve. No blocker, major, security, or correctness finding in the scoped repair.

- Only `operation.submit` switches from remote-dependent `whoami` to local
  `operation.status` for the same UUID. Ordinary methods keep the prior path.
- The daemon status handler still runs `bind`, `currentOwner` and `trackedOwner`;
  it does not infer or repair identity from an operation UUID. Ownership includes
  the immutable connection facts, current process birth, generation and epoch.
- Preflight results are ignored as replay authority. The subsequent submit still
  validates input, rejects retained UUID collisions, and atomically admits the
  observation with its queue row. No mutation fallback or retry was added.
- The existing authority-only `-32020` recovery is confined to the pre-dispatch
  block; submit/result failures cannot reach it. Local generation checks remain
  before submission and after its response, plus around recovery.
- Unsupported/invalid/preflight transport errors fail closed. The direct lookup
  path remains recovery-free.
- New tests cover send and ack through MCP, real daemon core and hub conformance
  harness while offline, unchanged retained queue on lookup, and later one-shot
  settlement. Additional tests cover invalid UUID, non-authority errors,
  preflight/recovery/submit generation changes and no retried rejected submit.

## Evidence boundaries and non-blocking follow-up

The added primary regression uses in-process daemon calls with fault-injected hub
transport; it is not a real Unix-socket/production outage experiment. Ordered full
suite, independent QA, packaging and CI remain the coordinator's gates.

A new IPC connection still performs the existing hello, including its flush, and
missing/retired registration recovery still uses hook whoami. The new method removes
the explicit remote topic lookup for a valid registered owner; it does not promise
all fresh connections or missing-registration recovery complete offline or without
unrelated hello work. The existing DESIGN paragraph immediately above records that
fresh hello may time out. Release claims should keep this qualification prominent.

No historical incident cause, original admission outcome, safe resend, or underlying
hub availability fix is established by this source review.

## Final QA test-only delta review

Re-read the final new test file after QA's four added cases: retired/superseded
owners, each with send/ack. The production source diff remains the same single
preflight substitution reviewed above. The new cases first pin a valid shim, then
retire or advance the real daemon owner, disconnect hub transport, and verify the
old wrapper returns unknown without dispatching operation.submit, admitting a
message/receipt row, or creating an observation. These supplement the mock-based
generation-switch tests with real daemon authority fences.

Final verdict remains **approve**, findings empty. No builds or tests executed by
this review lens.

## External independent lens

External code review completed with exit 0, verdict approve, no findings, before the four additive QA authority cases. The internal final review also approves those cases. Log: `/tmp/kom-offline-external-review.log`. Full release qualification remains a separate gate.
