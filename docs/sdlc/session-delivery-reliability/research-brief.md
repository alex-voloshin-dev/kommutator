---
type: research-brief
feature: session-delivery-reliability
status: approved
date: 2026-11-04
sources:
  - "spikes/RESULTS.md"
  - "docs/sdlc/session-delivery-reliability/research-tracks.md"
  - "packages/agentd/src/core.ts"
  - "packages/agentd/src/hub-link.ts"
  - "packages/agentd/src/ipc.ts"
  - "packages/cli/src/mcp.ts"
  - "packages/cli/src/hooks.ts"
  - "packages/cli/src/index.ts"
  - "packages/protocol/src/schemas.ts"
  - "docs/knowledge/codex-root-identity.md"
  - "https://code.claude.com/docs/en/tools-reference.md"
  - "https://code.claude.com/docs/en/plugins-reference.md"
---

# Remaining delivery reliability gaps

## Evidence and limits

Baseline: db2493f, deployed behavior 0.9.1.

Three independent internal [research tracks](research-tracks.md) inspected liveness, reconnect diagnostics and
topic watching. The sanitized incident observations are recorded in
[spikes/RESULTS.md](../../../spikes/RESULTS.md#2026-11-04-remaining-reliability-investigation-baseline-db2493f--091). The original private daemon record at 2026-11-04T00:43:15.968Z reports
Codex shim PID 589518, reason liveness, cause process-exited. In core.ts probeLiveness,
that cause follows a negative process-existence probe. Later heartbeat failures concern
another registration. This is evidence of the daemon's observation, not proof of either
a false retirement or the reason the vendor stopped its shim. No same-root shim shutdown
trace has yet been established. Private logs and tokens must not enter the public repo.

A separate defect was reproduced by an isolated in-memory probe of the deployed 0.9.1
bundle (see the same spikes evidence): registerOwner allows a Codex
process with unknown birth, but probeLiveness classifies missing birth as missing owner.
A transient process-start probe could therefore produce an immediately retired record.
The probe changed active/no-birth to gone despite processExists returning true
(core.ts registerOwner/probeLiveness). A permanent regression must accompany the fix.

Hub transport disconnect/timeouts throw OfflineError (hub-link.ts request), while IPC
maps non-RpcError failures to a generic daemon-request failure (ipc.ts handler catch).
The compatible-daemon preflight already tolerates hub reconnects (plugin-daemon.ts);
the old exact Shared daemon unavailable report is not a proven current recurrence.

Caller status is Claude-only: mcp.ts diagnostics selection validates Codex metadata but
uses generic diagnostics; DaemonStatusParams and core.ts statusForCaller select Claude
owners. A healthy shared hub therefore does not establish the current Codex root's health.
Unknown or ambiguous ownership must remain diagnostic uncertainty, never a guessed binding.

Hook entrypoint and runHook intentionally fail open with a deadline and empty stdout
for failures before output. Successful hooks can emit headers; a later failure cannot
retract them. Existing conservative receipt rules remain in DESIGN section 19.
They do not persist failed attempts (index.ts/hooks.ts), so explicit diagnostics cannot
separate observed success from failure. A hook that never executes cannot record failure.
Historical last_error after recovered connectivity is intentional, not an active fault
(knowledge/operability-evidence.md).

## Topic watch feasibility

Current CLI is an unbound management client; no watch command exists. Inbox headers lack
target topics, so client-side filtering through message.read would wrongly mark receipts.
A safe extension needs daemon-authorized exact local session selection and hub-side topic
filtering over that session's authorized deliveries, not a new recipient or implicit join.

Official Claude Monitor documentation says a background command's output lines become
events. Its documented deadline is five minutes by default and thirty minutes maximum
(ten in noninteractive runs). Thus an ordinary process can poll without model turns on
empty results, but events and watch renewal may consume turns; indefinite free native
wake is not promised. The dated local observation in [spikes/RESULTS.md](../../../spikes/RESULTS.md)
records Claude 2.1.318. Official plugin documentation also
supports experimental monitors; automatic startup is unnecessary for an opt-in watch.
Sources: tools-reference.md Monitor tool; plugins-reference.md monitors. Vendor execution
must be separately observed; documentation alone is not live acceptance.

## Recommendation and acceptance scope

Implement the direct user request in one reviewed feature:

1. Reproduce unknown-birth Codex registration and preserve uncertainty or defer binding;
   never revive on guessed PID identity or change the historical incident narrative.
2. Give hub-unavailable and daemon-stopping failures distinct bounded diagnostics without
   retrying already dispatched mutations. Add read-only Codex caller health using validated
   per-call root metadata and exact shim evidence, preserving fork rejection.
3. Record bounded private hook outcomes, with no raw payload, prompt, endpoint or token,
   expose them through explicit diagnostics, and preserve empty failure stdout/exit0 and
   the 200ms budget. Missing observation remains unknown.
4. Add opt-in kom watch --session <hub-id> --topic <name>, with an independent cursor and
   bounded JSON event lines only when eligible messages arrive. No model loop, receipts,
   implicit membership, identity inference or native adapter call. Restrict to an exact
   existing local session and current topic membership; pause under DND and while gone.
   Suppress FYI and hop-limited traffic by default, without marking it read. Document
   start cursor/restart semantics and the explicit topic-monitor opt-in exception to the
   ordinary no-topic-wake rule. Leave automatic vendor monitor installation out of scope.

Record final contracts in DESIGN section19 before implementation. Tests must cover
ownership ambiguity, live IPC during hub outage, interrupted hooks, no false receipts,
watch membership/DND/cursors/reconnect and no output on empty polls. Preserve existing
vendor idle-wake, day-long, reboot and physical-subnet acceptance gates.
