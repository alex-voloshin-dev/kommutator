# Hook diagnostic flush versus process deadline

## Scope and assumptions

The maintainer request is the plan: investigate the PR38 release gate failure before
changing assertions. Test-only repair; production hooks, observation storage, receipts,
identities, replay and 90/140/300ms deadlines are unchanged.

## Observed failure and contract

PR38 CI45649636476 reported an empty observation list for the nonstalled Stop case, despite
exit0, the expected output and all three IPC methods at168.216ms. This is retained in
`/tmp/kom-v0171-pr-failure.log`; a green branch/local run does not explain its cause.

DESIGN's hook observation contract explicitly permits incomplete/missing diagnostic evidence
when the hard entrypoint deadline interrupts the final best-effort flush. `runHook` queues
three serialized writes (unscoped attempted, scoped attempted, terminal). The fixed-slot writer
opens with O_TRUNC before asynchronous writeFile. An interrupted write may leave no readable
record. Such evidence is unknown and never a delivery receipt. The old process test required
the terminal record unconditionally, exceeding this contract.

## Controlled reproduction

A synthetic Node preload wraps only observation-file writes beneath this test's private
`kom-hook-ipc-*` home. After the real O_TRUNC open it holds writeFile unresolved and emits
one fixed marker. No IPC or hook timer is patched. The real compiled Stop entrypoint still
emitted its header and attempted the exact acknowledgement; the server rejected that ack.
It exited0 at178.545ms, below200ms target/300ms limit. The old terminal-record assertion failed
with observations=[] in `/tmp/kom-hook-observation-controlled-baseline.log`.
This proves a reachable contract mismatch. It does NOT prove CI's historical filesystem
latency or exact point of interruption. Production atomic writes are not introduced: lost
best-effort diagnostics are already documented, and changing that storage contract needs
separate justification and review.

## Repair without weakening delivery checks

- Completed-run coverage calls real runHook and real observation storage to completion with
  controlled RPC. PostToolUse and Codex Stop must persist exactly one terminal
  output-written-ack-unverified record with the correct event/reason/phase, emit one output,
  submit exactly the shown ack IDs, close once, and never spawn or leak remote error text.
- Real hard-deadline process tests retain the strict process budget, exit code, visible
  output, complete ordered IPC methods and exact ack ID checks. Retained diagnostics may
  be attempted or terminal but must never falsely report success. This removes only the
  false durability timing guarantee; completed persistence remains strictly required above.
- The controlled interrupted-write process case requires the stall marker and empty
  observations while preserving all output/failed-ack/exit/budget checks. It checks that
  no raw root or secret error text appears in observations. The preload is test-only,
  validates its temporary home and exact hook arguments, and is not a production option.

## Validation

Independent frozen dependencies; Node26.13.0/pnpm12.18.0. Ordered workspace build/typecheck
passed, then focused process-reliability, hook-rejection-outcome and hook-observations:
14/14 passed. Logs `/tmp/kom-hook-observation-{install,build,types,focused}.log`.
The controlled baseline failure remains preserved separately. Full integrated qualification,
independent review/QA and release decisions belong to the parent maintainer.
