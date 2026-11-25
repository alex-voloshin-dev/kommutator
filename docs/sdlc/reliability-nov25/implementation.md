# Reliability follow-up — November 25, 2026 UTC

## Scope and assumptions

The maintainer request is the implementation plan: investigate the remaining availability,
startup and IPC reports, reproduce defects before changing behavior, qualify narrow fixes
and publish only after independent review and QA. This work does not claim to resolve every
historical incident or permit replay of unknown operations.

Two isolated implementation tracks are under review:

1. HubLink resets reconnect backoff on hello before asynchronous synchronization succeeds.
   Repeated synchronization failures can therefore keep reconnecting at the initial delay.
   Prove the sequence with controlled sockets, then reset only after successful current-epoch
   synchronization. Retain readiness needed by synchronization, replay keys and request deadlines.
   Add bounded, allowlisted timeout evidence to identify the first request that terminated a
   shared connection without logging parameters or remote error text.
2. Hooks collapse IPC deadlines, ownership rejection and permissions into generic `failed`.
   Add private allowlisted reason/phase evidence, preserving historical observation files,
   fail-open behavior, receipt rules and the 140 ms entrypoint / 90 ms IPC deadlines.

## Existing evidence

Feedback #484 reports failed Codex UserPromptSubmit at 2026-11-24 22:25:03 UTC and
PostToolUse at 22:25:12 followed by successful PostToolUse from 22:25:14 on remote
client/daemon 0.16.1. This does not identify a cause or establish a 0.16.2 regression.
Additional bounded evidence was requested in message
4c411812-72eb-4e5f-b8bb-41b5a0c4f960 without requesting restart, resend or secrets.

The response to historical unknown-send attribution, message
69f1f95d-2c4f-4843-bbbd-f3a8da212106, supplied no matching owner observation or original
send and retained logs only after the relevant windows. This is inconclusive, not proof
of non-admission or non-commit. Outbox 644 remains untouched.

At 2026-11-25 02:50 UTC the production container was running/healthy, unchanged since
2026-11-24 02:41:27 UTC. IO-full avg10 was 0.30%, memory-full 0%. A bounded scan of the
current daemon log found nine retained rows since November 24, last at 02:42:19; absence
of later errors is not proof of continuous availability. No stress, kernel tuning, database
write, production restart or receipt/replay change was used for this investigation.

## Prior decisions

See `docs/knowledge/operability-evidence.md` for observed-vs-unverified acceptance,
`codex-root-identity.md` for exact root ownership, `docker-hub-isolation.md` for production
isolation and `agent-workflow.md` for review/qualification discipline. Existing #9/#19/#22/#25
and day-long/subnet/reboot/native-wake gates remain open until their individual evidence holds.

## Qualification

Pending. Record baseline failures, candidate gates and independent review/QA below. A later
passing run does not explain an earlier failure. Separate worktrees/dependency trees are used.

## Fresh availability report before cutover

Message7cbef222-0e35-480b-86b0-dc3daa66ead4 reports a transient board read failure at
03:08UTC on November25 from remote0.16.1, with active registration and hub disconnected,
then connected and a successful read. The hub-host daemon independently retained three
heartbeat failures at03:08:23.890–.893UTC. No hub/daemon restart occurred in this task
before the announced03:15UTC window. This corroborates an availability interval, not a
storage/network cause. Public artifact/native-install work was nearby but its contribution
was not measured. The bounded rollout observer started later and cannot explain this event.
