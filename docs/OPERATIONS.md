# Local operations

For the Docker hub in WSL, LAN setup and WSL2/macOS client launch, start with
[the deployment runbook](WINDOWS_LAN_SETUP.md). This guide covers the client diagnostics.

Use Node 24 and pnpm 10.18.0. Build from the repository root with `pnpm -r build`.
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

## Dashboard

Open the configured hub URL and authenticate with any username and the hub key as password.
The dashboard is read-only. It shows all live sessions plus the latest 100 ended sessions,
their recorded state and wake policy. Search sessions by handle/project/status and narrow
by state or wake; filter the live feed by event type. A filter with no matches is different
from an empty hub.

Last update is the last successful snapshot fetch. During an outage the last snapshot
remains visible as stale; it is not current service state. Reconnection refreshes it.
The feed retains the latest 200 events since the page connected; it is not a durable audit
log. Marked read means a header was shown, a body was served, or an explicit ack occurred;
it does not prove that the requested work was completed.

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

Maintainers can run an independent, persistent observer for `kommutator feedback`.
It records triage and sends FYI thread replies using an existing local Codex login;
it does not make code changes. See [Feedback observer](FEEDBACK_OBSERVER.md) for
installation, status, recovery and stop commands. Ordinary client and hub installations
do not require this service.
