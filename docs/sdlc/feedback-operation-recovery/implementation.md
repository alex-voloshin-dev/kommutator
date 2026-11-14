# Feedback operation recovery implementation

## Assumptions and scope

The user requested fixes and a qualified release for the current feedback. This change
addresses controlled operation observation loss and completion latency, plus misleading
compatibility recovery. It does not establish the cause of every field timeout, repair
past inaccessible observation ownership, dispose of blocked outbox work or resolve hub
transport outages. No production database was edited during implementation.

## Controlled reproductions

All tests used this worktree's independent frozen dependency installation with Node
26.13.0 and pnpm 12.18.0. No mutable node_modules were shared with another checkout.

- `/tmp/kom-operation-baseline-test.log`: pre-change implementation, two failures and
  26 passes. A confirmed observation and an offline queued observation both became
  `unknown` following a continuous Claude generation refresh.
- `/tmp/kom-operation-flush-baseline.log`: lineage candidate before completion change,
  one failure and 29 passes. The first operation was durably confirmed; a deliberately
  held unrelated second hub response still prevented its submit from returning.
  This demonstrates a mechanism compatible with confirmation preceding a timeout;
  it does not establish every historical reported timeout's cause.
- `/tmp/kom-operation-attach-baseline.log`: pre-attachment correction candidate, one
  failure and 35 passes. An initial offline registration reply crossed a refresh;
  the transferred observation's NULL session UUID remained unattached and lookup
  returned unknown after confirmation.

## Changes

The DESIGN §19 recovery contract was written before implementation. A validated,
consecutive generation refresh of one uninterrupted live Claude process/conversation
atomically transfers exact prior-owner observations with the saved current owner.
Old peers remain fenced. Gaps, retirement and replacement do not transfer. Initial
registration acknowledgement attaches only exact current-owner NULL observations under
narrow stable process/context guards, never transfers predecessor tuples.

Tracked submits finish after their own durable confirmation or block, or when the
shared flush ends. Shared flushing continues; disconnect/shutdown cancels the waiter,
not admitted work. Existing replay keys, retention, receipts and all hook timers remain.

Setup and both preparation paths compare validated runtime contract numbers and say
which component needs updating. A newer daemon never receives a restart recommendation.
Missing contracts do not guess a direction; malformed versions are not echoed. MCP
preserves only the explicitly typed local compatibility diagnostic, not arbitrary errors.

The pre-existing 256-confirmation retention test now expects the first submit to return
`sent` before unrelated completions. It still requires its later lookup to be `unknown`,
zero outbox work and exactly 256 retained observations. This is the intended completion
boundary change, not a weakened retention gate.

## Validation handoff

`pnpm -r build` and `pnpm -r typecheck` passed in round 3; full tests are reported separately
by the coordinator and independent QA. An earlier full test run failed only the obsolete
shared-flush completion expectation described above (190 other agentd tests passed).
No release qualification, publication or production rollout is claimed by this document.
