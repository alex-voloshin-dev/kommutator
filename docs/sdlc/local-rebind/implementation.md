# Local rebind of an established Claude owner

## Assumptions and scope

The maintainer requested investigation of persistent reconnect and local-operation failures.
The direct request is the plan; artifact discovery selected this directory. Stack detection
reported root JavaScript, with TypeScript source; both packs and the repository's ordered
gates apply. This change addresses a controlled head-of-line dependency, not the historical
cause of every failed registration, unknown operation or hub outage.

## Reproduction

A registered generation-1 Claude owner has a retained confirmed observation. An unrelated
Codex owner submits a message whose hub response is held behind a deterministic barrier.
A fresh Claude shim for the original exact owner cannot complete ipc.hello or reach local
operation.status until the unrelated flush settles. The original code fails the new
completion-before-release assertion: `/tmp/kom-local-rebind-baseline-test.log` (1 failed).
The barrier remains held until cleanup, which releases and drains both tasks. No production
service, database, endpoint or load generator participates.

## Repair

DESIGN section19 was updated before code. Only an explicit positive-generation Claude shim
for an already registered matching owner can use this path. Existing process-birth and
binding checks run first; any pending owner session.upsert/session.gone excludes the path.
The immutable owner/context snapshot is captured before reconciling its durable end marker
and probing birth again. Replaced/retired/context-changed owners, shutdown and disconnect
cannot complete hello or enable tracked operations. A concurrent owner lifecycle write
uses the original flush path. The successful local path neither starts nor joins a flush;
its local lookup leaves other owners' pending operations and replay authority unchanged.

Fresh or reincarnating registrations, Codex, hooks and manual generation-zero behavior
remain unchanged. Hub-dependent operations and mutation settlement can still wait for the
hub; local storage itself may stall. No schema, runtime contract, receipt or deadline change.

## Tests and retained failures

The new positive test covers actual DaemonCore/SQLite/hub conformance behavior and proves
that the same retained observation is accessible with no additional hub request or changed
outbox while the unrelated response remains held. Negative cases exercise changed process
birth/generation/retirement/context, disconnected/stopped peers, a real durable end marker,
and pending own lifecycle writes. Independent review and QA remain coordinator gates.

Initial candidate build/typecheck and48 operation tests passed. Expanded safety run had
57 passed/3 failed: two new synthetic lifecycle writes were invalid (full session used for
strict register/update schemas); one unchanged disk-backed queued-restart test exceeded5s,
whose cause was not established. The next run passed59/60; register still retained the
hub's extra handle field. Inspecting executable schemas established the invalid shape;
fixture writes now pass Methods[session.upsert].parse before enqueue, using Session projection.
No timeout or production validation was weakened. Retain `/tmp/kom-local-rebind-focused2.log`
and `focused3.log`; a later pass does not explain the old disk-backed timeout.

Final ordered build/typecheck passed (`/tmp/kom-local-rebind-{build4,typecheck4}.log`).
Operations60/60 passed (`focused4.log`); daemon-core, operation-recovery-boundaries and
IPC-errors139/139 passed (`/tmp/kom-local-rebind-boundaries.log`). Full workspace/packaging
qualification and independent review/QA remain coordinator tasks. This is not evidence of
real vendor restart/idle wake or the historical field incidents' causes.
