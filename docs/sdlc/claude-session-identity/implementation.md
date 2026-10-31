# Claude process ownership isolation

Observed 2026-10-31. The user reported two Claude sessions on one host returning the same
hub identity and vendor session ID, seeing each other's status, and repeatedly increasing
incarnation. Source inspection confirmed that every changed hook parent replaced the
record keyed only by vendor ID. MCP binding selected that record without checking the
process owner. A cold SessionStart conflict check did not protect subsequent hooks.

## Change and assumptions

The user's request is the implementation plan: distinguish concurrent sessions safely and
provide a consistent whoami diagnostic. This checkpoint covers the ownership correction;
the shared response template is documented separately.

Claude registration now matches vendor ID plus observed owner PID/process birth. Concurrent
owners receive separate records and hub identities; the public vendor ID is preserved.
Registration is serialized. One prior owner can be resumed only when its exit/PID reuse is
proven and cwd/project match; ambiguous history or context produces a new registration.
An unavailable process probe alone is not evidence that another process has exited.
Bound peers pin the owner generation and cannot follow a replacement or ended session.
Review exposed an asynchronous race between a birth probe and replacement registration.
The correction rechecks current ownership after probes, flushes and transport reads before
using results or mutating state. An unbound peer also pins its first observed birth.
Liveness sweeps recheck the generation before acting on a delayed probe. Live hook-only
owners remain registered without a native endpoint; socket availability is a delivery fact,
not proof of process lifetime.

The bundled bootstrap relays its observed vendor parent to the child runtime, overwriting
any inherited parent marker. Manual shims use their direct parent. Cold Claude context and
registration are scoped to the same owner; one owner's SessionEnd cannot remove another's
registration. Missing ownership fails explicitly. Codex per-call root identity is unchanged.

If duplicate resumed roots advertise the same native endpoint, both use hook capability;
the daemon refuses private native delivery through that ambiguous socket. Hook polling and
MCP inboxes remain scoped to independent hub identities.

The shared daemon runtime contract is now 2. After updating all client plugins, end active
sessions and use the installed plugin's `bin/manage daemon restart`, then start fresh
sessions with trusted hooks. This change does not automatically restart a running daemon
or install/update vendor profiles. Old plugin clients also require updating because their
contract-1 preflight will reject the new daemon. No hub schema or HTTP/WS contract changes.

## Engineer checks

- Frozen pnpm install passed with Node 24 and pnpm 10.18.0.
- Workspace build and typecheck passed after implementation.
- Full workspace tests passed (359 tests) before the final additional project-isolation
  regression. The final focused daemon suite then passed all 55 tests; the final combined
  workspace and artifact gates are tracked by QA.
- A subsequent full-suite attempt hit unchanged hub setup/backup timeouts while a packaging
  build overlapped it. Assertions and timeout limits were not changed; QA owns the final
  sequential release gate. This failed attempt is not counted as passing evidence.
- After the review corrections, workspace build/typecheck and all 67 focused daemon tests
  passed. Twelve additional regressions cover deferred process-probe, flush and transport
  races, stale sweep results, unbound-peer generation pinning and repeated hook-only sweeps.
  The earlier full release gate predates these corrections; QA must rerun it on the final
  exported artifacts before publication.
- Regression coverage includes concurrent hooks with one vendor ID, distinct handles/hub
  IDs, independent statuses and private inboxes, repeated-hook incarnation stability,
  one-owner exit survival, wrong-owner binding failure, stale process-generation rejection,
  unavailable birth probes, separate project context, and ambiguous native endpoint refusal.
- CLI tests cover separate saved contexts for two live owners, owner-only cleanup, stale
  registration rejection, normalized bootstrap parent use and runtime-contract preflight.

The process/runtime tests are synthetic; they do not establish native Claude wake behavior
for duplicated resumed conversations. Validation on the user's second machine, native
wake, reboot, separate physical subnet clients and full-day use remain separate gates.
