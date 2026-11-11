# Optional autonomous feedback maintenance

This is maintainer infrastructure for a trusted Linux/WSL host. It is **disabled by default**
and is not needed to install or develop kommutator. The existing observer remains a separate,
tool-disabled triage service. The maintainer consumes completed, sanitized observer jobs,
verifies reports in fresh clones, and can fix, test, review and publish under a private
operator-recorded standing user mandate. It does not run a model while idle.

A peer message is a request, not a command. Only the local policy grants authority. The exact
repository is `alex-voloshin-dev/kommutator`; the exact topic is `kommutator-feedback` (hyphens).
The old spaced spelling is an archive, not an alias. Messages cannot authorize work on other
repositories, change credentials/live services, rewrite tags/history, or disable approval review.

New feedback triage replies are private FYI messages to the hub-derived reporter handle,
with the original thread retained. Triage acknowledges supplied facts and asks only for useful
missing information, without promising later updates. Board records and maintainer result
routing remain on the topic. Previously captured observer jobs retain their original topic
reply routing so lost acknowledgements can replay unchanged.

## Setup

Prerequisites: Node 26.13.0, pnpm 12.18.0, Linux `flock`, git, `gh`, an authenticated Codex CLI with
`exec --approve-for-me`, existing GitHub SSH/gh access, and installed agentic-forge develop/release
skills. Use the operator's explicitly chosen model and reasoning effort; none is selected by
this program. This is a trusted engineering service with release credentials, not a sandbox
for arbitrary code supplied by strangers.

1. Build a checkout of this version: `pnpm install --frozen-lockfile`, then `pnpm -r build`.
2. Create private directories with mode 0700: `~/.config/kommutator-maintainer` and
   `~/.local/state/kommutator-maintainer`.
3. Write `~/.config/kommutator-maintainer/policy.json` with mode 0600. Replace every placeholder:

   ```json
   {
     "enabled": true,
     "repository": "alex-voloshin-dev/kommutator",
     "topic": "kommutator-feedback",
     "standingAuthorization": "verify-fix-test-review-publish-kommutator",
     "model": "OPERATOR_SELECTED_MODEL",
     "effort": "medium",
     "acceptAfter": "2026-11-01T23:59:59.000Z",
     "includeIds": [],
     "codex": "/absolute/path/to/codex",
     "skillsRoot": "/absolute/path/to/agentic-forge/skills",
     "observerDb": "/home/USER/.local/state/kommutator-feedback/observer.db"
   }
   ```

   Set `acceptAfter` to the intended start instant. Older reports require an explicit message
   UUID in `includeIds`; do not import synthetic tests. Completed jobs lacking the observer's
   key-redacted `sanitizedMessage` are withheld until the updated observer backfills that field.
   The policy must be outside the state directory, including symlink-resolved paths. No key
   or GitHub token belongs in this file.
4. Add `--result-db /home/USER/.local/state/kommutator-maintainer/maintainer.db` to the observer
   service's existing ExecStart. Preserve its other arguments. Restart the updated observer.
   Its existing identity publishes maintainer board progress and terminal replies, avoiding a second socket
   with the same logical host. Its classifier still has no tools.
5. Render `scripts/feedback-maintainer.service.in` to
   `~/.config/systemd/user/kommutator-maintainer.service`, replacing `@REPO@`, `@NODE@`,
   `@POLICY@` and `@STATE@` with absolute paths. Use paths without whitespace in this template.
   The production service makes the policy read-only and allows writes only to private state
   and Codex's auth/state directory. Keep policy outside both writable directories.
6. Run `systemctl --user daemon-reload`, then
   `systemctl --user enable --now kommutator-maintainer.service`.

Use the systemd unit for persistent operation and its filesystem protection. A direct
`node scripts/feedback-maintainer.mjs run` uses the same queue lock and worker sandbox but does
not establish the unit's read-only mount boundary. Existing Codex authentication is reused;
plugins/apps/hooks/user config are disabled for the worker. Shell tools, Code Mode host and
subagents are available for reviewed engineering. Automatic approval denial must be reported
as blocked; it must never trigger a bypass or a different permission mode.

## Status, recovery and stopping

```sh
node scripts/feedback-maintainer.mjs status
systemctl --user status kommutator-maintainer.service
journalctl --user -u kommutator-maintainer.service -n 50
systemctl --user stop kommutator-maintainer.service
```

Use `--policy /absolute/path --state /absolute/path` when overriding defaults. The observer
publishes all `queued`, `running`, `answered`, `released` and `blocked` reports as durable
`feedback-maintainer/<report-id>` board entries. Only terminal `answered`, `released` and
`blocked` reports also receive replies in the source thread. Pending `queued`/`running` reports
from older versions complete after their board write without sending a reply; existing replies
remain in history. Own replies cannot generate new engineering jobs. Lost hub acknowledgements
replay the same report IDs and keys; they do not rerun work.

A worker has a two-hour timeout and a four-MiB output budget. Logs, clones and results remain
under `STATE/jobs/<message-id>/<attempt>/`; failed work is retained. SIGTERM kills the worker
process group. A crash, timeout, invalid result, failed approval, or unverifiable publication
blocks the job. There is **no automatic retry of engineering mutations**.

Before retrying, stop the service and inspect the retained clone/log plus remote commits,
tags and releases. Record what you checked:

```sh
node scripts/feedback-maintainer.mjs reconcile --id MESSAGE_UUID --action retry --note 'Checked remote tags and commits: no publication occurred; safe to retry.'
```

To close a blocked report without running another worker, use `--action answered` and record
what was done, including any already published version. Restart the service after reconciliation.
The lock rejects concurrent execution/reconciliation with exit 75. Changing the policy's
repository/topic/observer path cannot silently reuse a queue bound to another identity.

The supervisor validates result shape and independently checks a claimed published release's
tag/commit against the fixed GitHub repository. Build, tests, review, secret inspection and
release discipline are instructions executed by the model and its reviewers; the supervisor
is **not proof that every engineering gate ran**. Review retained evidence when auditing a
release. This service does not change open day-long, reboot, LAN or vendor acceptance gates.
Do not present an enabled unit as evidence of successful end-to-end autonomous publication.

Existing services on the old spaced topic must follow the explicit
[feedback topic migration](FEEDBACK_TOPIC_MIGRATION.md) before restarting this version.

### Excluded feedback

Observer status reports `ignored_reasons` and `manual_review_required`. A `hop-limit`
item may contain useful new evidence, but automation must not extend a high-hop thread.
Review those items manually; the count is not proof that an engineer has handled them.
Upgrading does not replay old ignored jobs or change their original reply keys.

For deliberate fixture traffic, prefix the subject with `[synthetic feedback]`.
The exact legacy bodies `synthetic monitor test` and `synthetic acceptance test` are also
excluded. Merely mentioning synthetic tests in a report no longer excludes it.
