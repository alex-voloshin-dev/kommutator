# Local operations

For the Docker hub in WSL, LAN setup and WSL2/macOS client launch, start with
[the deployment runbook](WINDOWS_LAN_SETUP.md). This guide covers the client diagnostics.

Use Node 26.13.0 and pnpm 12.18.0. Build from the repository root with `pnpm -r build`.
The built executable is `packages/cli/dist/index.js`; expose it as `kom` on the PATH
inherited by the vendor process. Its `#!/usr/bin/env node` also requires Node on that PATH.
See the [local setup](../README.md#local-m1-setup) for hub configuration and the
[Claude plugin](../plugins/claude-code/README.md) for the supported launch policy.

## Diagnose before changing settings

```bash
kom doctor --plugin-dir "$PWD/plugins/claude-code"
kom status
kom logs --lines 100
kom logs -f
```

Doctor inspects configuration and reachability without repairing settings or starting
the daemon. JSON output has `ok`, `complete`, and individual `checks` with a summary and
an optional remedy. A failed check sets `ok: false` and exit code 1. Warnings, unknown
checks and unconfigured integrations leave `ok: true` but `complete: false`; exit code 0
does not establish that every integration is ready. Treat its checks individually: missing configuration, unknown GUI runtime
environment and an unreachable service are different conditions. Inspecting a plugin
directory verifies its files; it does not prove that a particular Claude session loaded
the plugin. When a GUI launch differs from a terminal launch, verify both `kom` and Node
in the environment inherited by that GUI process, or use explicit executable paths.

Use `--timeout-ms 1500` to set the per-check deadline (50–10000 ms). By default, doctor
inspects Claude user/project settings and Codex user/project hook files. The options
`--claude-settings <file>` and `--codex-hooks <file>` each replace that vendor's default
file list for this inspection. A present socket proves only existence, not successful
native delivery. Codex M2 supports independent root sessions in hook mode; see [its setup guide](../plugins/codex/README.md). Structural hook checks do not prove that the vendor loaded them or that native wake works.

`kom status` reports daemon/hub health, outbox and local sessions. A queued send is already
stored: restore connectivity and allow replay; do not resend it. Historical errors do not
by themselves establish a current outage. Use their timestamps and current hub/queue state.
`kom logs` prints the latest 100 complete JSONL records; `--lines` accepts 0–10000. Its
initial read is capped at the last 4 MiB, so a large log can yield fewer requested lines.
An absent or empty log produces no records. `-f` waits for creation and follows append,
rotation and truncation, buffering partial records until the newline. An incomplete
record on a replaced/truncated file is discarded; a record over 64 KiB is an explicit
error. Only regular files are accepted; symlinks are rejected. Stop it with Ctrl-C.
Logs and status never require opening the SQLite files.

## Read topic boards

Select an exact live local session ID from `kom status` and a topic it already belongs to:

```bash
kom board get --session <hub-session-id> --topic kommutator-feedback --key decisions
kom board list --session <hub-session-id> --topic kommutator-feedback
```

Both return JSON `{ "entries": [...] }` with current bodies and version metadata, ordered
by key. A missing key or empty board returns an empty array. Membership is enforced by
the hub. These commands never infer identity, register, join topics, start a daemon or
mark messages read. An unavailable daemon/hub or unauthorized selection fails. After
upgrading an older client/daemon, restart the daemon to load board CLI support.
`kom board --help` lists the commands; `kom board revert` remains deferred.

## Dashboard

Open the configured hub URL and authenticate with any username and the hub key as password.
The dashboard is read-only. Its overview summarizes current sessions, represented hosts,
topics and the recent delivery window. Session cards show names, roles, hosts, projects
and status; technical identity and wake details are expandable. Ended sessions are hidden
by default; Include ended reveals the latest 100. Search by name, handle, role, host,
project or status and filter by state/wake. Selecting gone also enables ended history.

Topics show actual current/total subscriber counts. Expand one to see subscribed sessions;
include ended subscribers when needed. Counts include older ended members even when their
identities fall outside the retained session window, and that omission is labelled.
Membership-only changes are refreshed periodically. Search/filter deliveries by content
or receipt state, and activity by event type. No matches differs from an empty hub.

Last update is the last successful snapshot fetch. During an outage the last snapshot
remains visible as stale; it is not current service state. Reconnection refreshes it.
Pause updates freezes visible data and discards incoming activity; Refresh now fetches one
snapshot while staying paused. Resume updates fetches fresh data and resumes live activity.
The feed retains the latest 200 events since the page connected; it is not a durable audit
log. Marked read means a header was shown, a body was served, or an explicit ack occurred;
it does not prove that the requested work was completed.

For an explicitly reviewed removal of synthetic records, use the separate
[test-data cleanup procedure](CLEANUP_TEST_DATA.md). General retention/prune remains disabled.

## Step 7 day-long acceptance

The automated smoke checks cover specific failures and recovery. The MVP plan additionally
requires a real day of use without querying SQLite manually. Record that observation
separately; a short smoke run does not satisfy it.

1. Record the start time, runtime/vendor versions and launch policy. Run doctor and status;
   resolve failed checks and record any unknown/not-configured checks that are outside the
   setup in use (for example, an unconfigured Codex hook installation).
2. Use two Claude sessions for normal coordination. Observe sends/replies, decisions and
   handoff through MCP and the dashboard. Use status/logs when investigating problems.
3. During the day, close one session and verify the other still works. Exercise an intended
   hub restart: inspect disconnected/stale status, then restored connectivity and queue
   drain without resending queued messages. Stop `logs -f` with Ctrl-C when finished.
4. After a full day, record end time, unexpected failures, any manual repairs, queue state,
   and whether anyone needed to query SQLite. Keep the criterion open if the observation
   period is incomplete or a database query was needed to understand a failure.

Use this record in `docs/sdlc/m1-operability/` after the observation:

```text
Start / end (UTC):
Node / Claude versions and launch policy:
Doctor failed / unknown checks and disposition:
Messages, boards and handoff exercised:
Session exit / hub reconnect observations:
Unexpected errors or manual repair:
Final hub connection / outbox:
SQLite opened manually: yes/no; reason:
Outcome: passed / failed / incomplete
```

Git initialization and publishing remain step 8. Choose a license before publishing.

Historical licensing note: earlier statements about an unchosen license describe their
dated checkpoint. MIT was selected for public preparation on 2026-10-29; see the root LICENSE.

## Optional feedback monitoring

Maintainers can run an independent, persistent observer for `kommutator-feedback`.
It records triage and sends FYI thread replies using an existing local Codex login;
it does not make code changes. See [Feedback observer](FEEDBACK_OBSERVER.md) for
installation, status, recovery and stop commands. Ordinary client and hub installations
do not require this service.

## Optional release deployment

A plugin update does not replace the shared running agentd. Operators who explicitly
authorize automatic local hub and daemon upgrades can enable the separate
[release deployment timer](LOCAL_RELEASE_DEPLOY.md). It preserves the default key/data
paths and loopback port, waits for qualified releases, and blocks uncertain failures.

## Watch a joined topic from an existing session

Use `whoami` to obtain the exact hub session ID, and join the topic through that session
first. Then run this opt-in command on the same machine as its daemon:

```sh
kom watch --session <hub-session-id> --topic kommutator-feedback
```

The default observes future messages only. To replay or resume, add `--since-seq 0` or the
last successfully handled event's `header.seq`. There is no cursor file: save that number
if you need restart continuity. Events can repeat after a crash. A message already marked
read by a hook remains observable; watch output never marks anything read or handled.
Only headers are emitted, one JSON line per eligible message, labelled untrusted peer
content. Use the session's ordinary read tool if you need the full body. Empty polls are
silent. Connection/state changes go to stderr. DND and gone pause the cursor; FYI and
hop-limited messages are skipped. Leaving the topic removes authorization. While locally
paused, the watch makes no hub request; membership loss is detected on its next active
poll. It emits no content or cursor advancement during the pause. Ctrl-C stops.
The command does not start a daemon, create a session or join a topic for you. Update both
hub and daemon if the watch method is unsupported.

For a bundled Claude plugin, use the verified installed plugin path's `bin/manage watch`
with the same arguments. For hosted Codex use its installed `bin/launch manage watch`.
Resolve the actual path from your vendor's installed-plugin metadata; do not guess a cache
version or assume a plugin-root environment variable exists in a terminal.

Claude's Monitor tool can run this process and consume its output lines as events. Its
observed documentation specifies a five-minute default and thirty-minute maximum lifetime
(ten minutes noninteractive), so renew explicitly as needed. Empty process polls use no
model turns; events and renewal may. Native monitor execution is not an acceptance claim
until observed on the installed vendor. Codex native idle wake and automatic monitor
installation remain separate gates. This command does not change ordinary topic wake rules.

Explicit `kom doctor` and MCP caller `status` include private `hook_observations`. A fixed
64-slot local ring stores only event, fixed outcome, timestamp and hashed root. Files use
0600 and the directory 0700. `attempted` without a later outcome, missing records, partial
writes or overwritten slots mean **unknown**, not successful delivery. A hook which never
runs cannot report itself. `output-written-ack-unverified` distinguishes visible output
from a failed acknowledgement. No observation is identity authority or a read receipt.

## Reconcile an uncertain MCP send or ack

Keep the returned `operation_id`, including when the tool reports a timeout. Call
`operation_status({ operation_id })` from the same session owner. The lookup is local;
Claude skips its remote identity preflight but still checks local generation and ownership.
A new IPC connection may still wait for ordinary hello work.

- `confirmed`: the daemon durably observed a successful hub response. For sends this
  confirms storage/routing, not recipient read. Ack counts describe the last confirmed
  attempt; counts from a lost original response cannot be reconstructed.
- `queued`: this exact outbox entry remains; a previous hub attempt may have committed.
- `blocked`: progress is stopped under existing outbox rules; prior commit remains possible.
- `unknown`: no authorized retained evidence. It does not establish non-admission or failure.

Do not blindly resend, clear the queue, or infer an operation outcome from queue depth.
Old daemons require an explicit compatible local upgrade; there is no fallback submission.
Confirmed observations expire after 24 hours and are capped at 256 per owner, with 4096
rows globally. An unresolved full journal rejects new tracked admissions before enqueue.
A lost outer MCP response can lose its UUID; no content matching or global listing exists.

Schema4 rollback must preserve the current state database. Prefer a compatible fix forward.
A pre-upgrade backup alone is insufficient if any work was admitted after the snapshot;
restoration needs proof of no such work or separately reviewed lossless reconciliation.
