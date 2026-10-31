---
title: Operability checks and evidence limits
type: note
tags: [operations, diagnostics, testing]
---

# Operability checks and evidence limits

M1 step 7 adds `kom doctor`, `kom status`, `kom logs -f` and dashboard filters/freshness.
The [operations guide](../OPERATIONS.md) gives commands and the day-long acceptance record;
[DESIGN §19](../DESIGN.md#19-implementation-decisions-and-open-questions) defines the
implementation choices. The [step 7 checkpoint](../sdlc/m1-operability/implementation.md)
links checks actually run.

Doctor and status do not start the daemon. Doctor separates current-process PATH from
launchd evidence, file wiring from runtime activation, and socket existence from native
delivery. An unknown GUI environment or a structurally valid plugin does not establish a
working vendor launch. The CLI-only diagnostic IPC exposes socket-presence booleans, not
endpoint paths or tokens. Codex hook inspection is structural; runtime support is post-M1.

Current status health follows hub connectivity and blocked outbox entries. A timestamped
last error may remain after recovery. A queued send is already stored and should replay
without manual resending. The dashboard retains its last successful snapshot during an
outage, marks it stale, and refreshes after reconnect; its feed is bounded and not durable.

The [MVP plan](../MVP_PLAN.md#step-7--operability) requires a full day of real use without
opening SQLite manually. Unit, process and browser smoke checks are separate evidence;
the day-long criterion remains open until that observation is recorded.
