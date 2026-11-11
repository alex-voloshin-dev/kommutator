# Optional feedback observer

This Linux/WSL maintainer service watches `kommutator-feedback`, records triage on that topic's
board, and replies in the source thread. It runs independently of an interactive coding
session. Ordinary hub and plugin installations do not need it.

The service invokes an already authenticated local Codex CLI only for new feedback. Each
invocation has no tools, runs in a private empty directory, and returns validated JSON.
Feedback cannot authorize code changes, deployment, commands, or messages to another topic.
Responses are automated suggestions, not verified diagnoses or commitments to fix something.
Model use consumes your existing Codex allowance. Default limits are one worker, at least
60 seconds between invocations, a 180-second timeout, and three attempts per message.

## Install

Use Node 26.13.0, pnpm 12.18.0, Linux `flock`, and a Codex CLI with an existing local login.
The tool-disabled invocation was qualified against Codex 0.164.0; recheck its tool menu before
upgrading that binary. Codex 0.164.0 can emit an error-item advisory stating that Code Mode
is unavailable because its host is disabled and will fail closed. The observer accepts only
that exact qualified advisory; other error items and tool activity still abort analysis. The existing kommutator client configuration must already connect to
the hub. Do not put its key in the unit file, command arguments, or this repository.

From your checkout:

```sh
pnpm install --frozen-lockfile
pnpm -r build
command -v node
command -v codex
```

Copy `scripts/feedback-observer.service.in` to
`~/.config/systemd/user/kommutator-feedback.service`. Replace `@NODE@`, `@CODEX@`, and
`@REPO@` with the absolute executable and checkout paths printed above. Paths containing
spaces require systemd quoting. Set `@MODEL@` and `@EFFORT@` to your selected Codex model
and reasoning effort; these explicit options are necessary because the worker ignores user
configuration to exclude plugins and MCP servers. This does not change your normal Codex
configuration. Keep the unit private (`chmod 600`). Then:

```sh
mkdir -p ~/.local/state/kommutator-feedback
chmod 700 ~/.local/state/kommutator-feedback
systemctl --user daemon-reload
systemctl --user enable --now kommutator-feedback.service
systemctl --user status kommutator-feedback.service
node scripts/feedback-observer.mjs status
```

The default configuration is `~/.kommutator/config.json` (or `$KOM_HOME/config.json`).
The private journal lives in `~/.local/state/kommutator-feedback`; it stores message bodies,
results, identity and replay keys. Directory permissions are 700 and files 600. Treat this
as private runtime data. No credentials are passed into model input or inherited worker
environment. Known hub keys and common credential patterns are redacted, but this is not a
general-purpose secret scanner: do not post secrets to feedback.

The observer uses a distinct logical host ending in `-feedback-<hash>` to avoid displacing
the interactive daemon's connection. Its session vendor is `other`. Do not run a second
observer with a different state directory for the same host/topic. `run` holds a kernel lock
for its state directory; duplicate starts exit 75. `_worker` is an internal entrypoint.

## Operate

```sh
journalctl --user -u kommutator-feedback.service -n 30 --no-pager
node scripts/feedback-observer.mjs status
systemctl --user stop kommutator-feedback.service
systemctl --user start kommutator-feedback.service
```

Status shows counts, cursor and generic error text, never message bodies or credentials.
A failed model job remains visible after restart. After correcting authentication or CLI
problems, explicitly retry failed jobs with:

```sh
node scripts/feedback-observer.mjs retry
```

Custom `--config`, `--state-dir`, and `--topic` options must match for run/status/retry.
Changing the hub, host or topic requires a separate journal; mismatches fail closed. Polling
is every 15 seconds (`--poll-ms`). `--cooldown-ms` and `--timeout-ms` tune the bounded worker.
Do not delete the journal while the service is active: it is the durable deduplication record.

The service catches feedback received while it was stopped, after its first topic join.
It does not claim or retroactively process earlier history. Existing board records can be
reviewed separately. Self replies, pure acknowledgements, and high-hop messages are skipped;
FYI feedback is deliberately processed. Failed hub requests retain work and replay IDs.
Stopping keeps its mailbox rather than marking it gone; retirement is a separate operator action.

Enable lingering for your Linux user if the service must survive logout. On WSL, systemd
starts only after the distribution starts: Windows reboot/logon startup is a separate host
configuration and requires a real reboot test. This service does not establish that gate.
The unit gives the worker a read-only filesystem except its private journal and existing Codex
profile (authentication refresh may write there); adjust `ReadWritePaths` if using a custom
`CODEX_HOME`. Its process group is terminated on timeout and systemd kills remaining children
on service stop.

## Checks and references

```sh
pnpm test:feedback-observer
```

Tests use isolated production hub dispatch and SQLite, fake workers, and synthetic keys; they
never send feedback to the operator's real hub. See DESIGN's optional observer recovery
contract and [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
Long-duration availability, Windows reboot, and external subnet checks remain separate gates.

For separately authorized engineering and publication, see the opt-in
[feedback maintainer](FEEDBACK_MAINTAINER.md). It does not grant tools to this observer.

Existing services on the old spaced topic must follow the explicit
[feedback topic migration](FEEDBACK_TOPIC_MIGRATION.md) before restarting this version.
