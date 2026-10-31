# Bypass delivery follow-up — opt-in passed

The [2.1.310 results](../RESULTS.md) show that an external process is Held by a bypass
recipient with the default inbound policy, even with its correct token. Manual native
wake passed. The user then authorized a per-session opt-in experiment, executed on
2026-10-25 with the same Claude Code version. No product acceptance-scope change is implied.

## Observed result

| Policy / timing | Result |
| --- | --- |
| Fresh bypass/default control, token, half-close after 8 s | Held, no automatic pong |
| Bypass/explicit accept, token, half-close after 8 s | Native idle turn and pong, 2.712 s from write |
| Same accept target, token, immediate half-close / 5 s timeout | Native idle turn and pong, 3.130 s from write |

All senders were external to Claude's ancestry and stayed alive for 45 seconds, beyond
socket close. No sender-mode attestation or dialog approval was used. All socket replies
were empty. The observed envelope and immediate half-close timing work; the production
adapter was not invoked and still contains its provisional envelope. See the
[report](../RESULTS.md) and
[sanitized evidence](../evidence/2026-10-25-claude-2.1.310-bypass-optin.json), including
harness source, launch arguments, transcripts, hook events and ancestry snapshots.

## Tested policy: explicit session opt-in

Keep the shared external daemon and require an explicit, user-selected inbound opt-in
for a bypass session that should receive unattended kommutator messages. The tested
setting is `crossSessionInbound: accept`, scoped to that launch with `--settings`.
This accepts peer messages generally for that session, **not only authenticated kommutator
senders**. It is a policy choice, not an additional KOM_KEY check. Do not put it into
global settings or silently add it during `kom init`.

[Official inbound controls](https://code.claude.com/docs/en/cross-session-messaging#control-inbound-messages)
describe the setting and permission-class defaults. The experiment verifies an external
poster, not our daemon. The same documentation distinguishes process
evidence from token fallback in [own-child verification](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).

## Reproduction procedure

Only run after the user chooses this policy. Recreate the private capture and post wrapper
from [M1_LIVE_RUNBOOK](../M1_LIVE_RUNBOOK.md#1-prepare-one-disposable-project) in a fresh
scratch project; the prior run's credentials and processes were removed.

1. Start the default-policy bypass control with the runbook command. Confirm effective
   policy, wait for idle and post a unique harmless pong request from a separate live
   process with the fresh token. Record Held/Delivered and a 30-second observation window.
2. Exit the control and capture a fresh target with this candidate launch:

   ```bash
   cd "$KOM_SPIKE_LAB"
   claude --name spike-bypass-opt-in --dangerously-skip-permissions \
     --setting-sources local --settings '{"crossSessionInbound":"accept"}' \
     --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools ""
   ```

   Record all applicable settings. `/config` may omit the row while a CLI override sets
   it. Do not remove managed/project `hold` or `refuse` to obtain a pass.
3. After ready/idle, use the same tested envelope, fresh token and a unique marker:
   `{"type":"user","message":{"role":"user","content":"spike01-E: reply here with pong-E; do not use tools"}}`.
   The external sender must stay alive during processing and after socket close. The
   executed follow-up used the `harness_source` saved in its evidence JSON: it keeps the
   sender alive for 45 seconds independently of socket lifetime. The original runbook's
   `post.mjs` exits on close, so by itself it does not reproduce this control.
4. Pass only on automatic idle turn plus matching pong, without dialog approval or an
   extra prompt. Record socket output separately; silence still means outcome unknown.
5. Repeat using the adapter's exact write/half-close timing:
   the existing adapter calls `end()` immediately, while the initial spike waited eight
   seconds. Neither transport completion proves model delivery. The origin of both sends
   must remain the actual external process, with no fabricated sender permission class.
   Both timings passed in this follow-up. Verifying the production adapter still requires
   invoking its updated implementation in the daemon/shim path.
6. Exit the target and remove this run's private captures/settings/processes using the
   runbook cleanup. Save sanitized evidence and versions under `spikes/evidence/`.

If default policy is a product requirement, this candidate is insufficient. Investigate
documented, truthful sender identity/permission attestation separately; no field or support
for an external daemon has been verified. Do not relabel arbitrary peer traffic as
the recipient's own child, claim an unknown sender is bypassing, or rely on process-exit
timing to obtain the own-child exception.

## Gate after the experiment

- The observed native support matrix is manual/default and bypass/explicit opt-in;
  bypass/default remains Held. Adopting opt-in as an M1 requirement needs a separate
  product decision. The user approved this test, not a global configuration change.
- Hook fallback is the planned alternative for Held combinations, not native idle wake;
  its production implementation is still pending.
- Real MCP detached survival, two-shim lifecycle and the full M1 E2E remain separate checks.
