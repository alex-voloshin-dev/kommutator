# Deployment health gate implementation

## Scope and assumptions

The direct maintainer request is the plan. Preserve aggregate health and all queued work,
but distinguish successful deployment from an unchanged preexisting blocked backlog.
No protocol, database schema, replay, daemon lifecycle or client-identity change is made.
The updater supports runtime contract4 exactly; a later contract needs a reviewed change.
The status snapshots are from the existing CLI status path, not MCP caller-wrapped status.

## Reproduction and repair

The 0.16.0 rollout reached the target versions and connectivity, then failed its health
gate solely because a pre-cutover recipient-not-found reply remained blocked. The old gate
required aggregate healthy and accepted any positive runtime contract. The new controlled
staged-deployment test reproduces the first defect against unchanged source: it fails after
20 polls with `new daemon did not become healthy` (10,059 ms test time). Log:
`/tmp/kom-deploy-health-baseline-red2.log`. An earlier test invocation failed to import missing
protocol dist and ran no behavior; `/tmp/kom-deploy-health-baseline-red.log` is not red evidence.
Frozen install and isolated protocol build supplied that test prerequisite; no shared dist.

The candidate requires exact version/contract4, positive PID and explicit connectivity.
Healthy status must have no issues and no blocked rows. Degraded status is accepted only
for the exact blocked-work issue with a complete validated snapshot whose remaining blocked
rows match pre-activation ID, method and error. Unknown issues, malformed/inconsistent or
duplicate rows, new/changed errors and wrong runtime identities fail closed. Elapsed ages
may change. The result preserves aggregate state, retained blocked count and a fixed warning,
without exposing remote error strings. No queue mutation/retry or evidence of non-commit is
introduced. DESIGN §19 was recorded before implementing this behavior.

## Checks

- Node26.13.0 / pnpm12.18.0 frozen install passed.
- Protocol-only prerequisite build passed; no full workspace gate claimed.
- Focused updater suite: 25/25 passed, including staged activation with retained backlog,
  unchanged backup/order checks and negative readiness controls.
- `git diff --check` passed.
- Root will run ordered build/typecheck/test and packaging on the integrated changes;
  independent review and QA remain pending at this handoff.

## Operator limit

The installed runner0.12.0 is separate from candidate services. Its old readiness gate will
not update merely because a new release is published. The runbook now requires staging the
reviewed runner/dependencies under a new private path with timer drained/lock free, updating
the unit and retaining old runtime material. No service or runner was changed by this task.
The source test proves the gate's decision, not a future live rollout or every peer recovery.
