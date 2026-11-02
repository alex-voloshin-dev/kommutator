# Optional local release deployment

The hub and shared client daemon are different processes. Updating a plugin does not replace
an already running agentd. The optional timer applies qualified published versions to both
services on a trusted Linux x64 host. It uses the existing default Docker deployment, private
key, database and `~/.kommutator` state. It does not change vendor installations or profiles.

This is disabled by default. The operator must explicitly authorize local service restarts;
a feedback message or release alone cannot grant that permission. Prereleases marked in
GitHub are included when their tag is numeric `vMAJOR.MINOR.PATCH`. Semver suffix tags are
not supported. Node 24, pnpm 10.18.0, gh authentication, git, flock, Docker Compose and access
to the local Docker socket are required. Docker access is a powerful host permission.

Create `~/.config/kommutator-release-deploy` with mode 0700 and `policy.json` with mode 0600:

```json
{
  "enabled": true,
  "repository": "alex-voloshin-dev/kommutator",
  "authorization": "deploy-released-hub-and-agentd",
  "baselineVersion": "0.0.0"
}
```

The baseline is the operator-verified version already applied to both services. Use `0.0.0`
to perform an initial managed deployment of the current qualified release. After success,
the durable checkpoint takes precedence. Policy must remain outside the private updater state
at `~/.local/state/kommutator-release-deploy`. Never put credentials in this policy.

Render `scripts/local-release-deploy.service.in` to
`~/.config/systemd/user/kommutator-release-deploy.service`, substituting absolute `@REPO@`
and `@NODE@` paths without whitespace. Copy `scripts/local-release-deploy.timer.in` to
`~/.config/systemd/user/kommutator-release-deploy.timer`. Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now kommutator-release-deploy.timer
node scripts/local-release-deploy.mjs status
```

The timer checks every five minutes while the user's systemd manager and WSL are running.
It waits for uploaded Linux assets and successful latest exact-commit Release checks and
Secret scan runs. It builds a fresh release clone and Docker image, verifies existing and
rendered deployment settings, backs up both SQLite databases, recreates the hub, and restarts
agentd from that retained clone. Actual running versions fence accidental downgrade even if
the baseline was set too low. It does not rebuild the working contributor checkout. The
CLI still uses the existing user configuration/key; a missing Claude registration requires
the real vendor SessionStart hook, normally by resuming that conversation.

The oneshot service intentionally uses `KillMode=process`: agentd is a persistent detached
child that must survive the updater's exit. Stopping this updater does not stop agentd. A
failed or interrupted update is blocked, not retried or rolled back automatically. Inspect
its private attempt logs, database snapshots and actual service versions before reconciling:

```sh
systemctl --user stop kommutator-release-deploy.timer
node scripts/local-release-deploy.mjs reconcile retry 'Inspected services and retained attempt; safe to repeat the upgrade.'
# Or accept only after independently verifying both services match the target version:
node scripts/local-release-deploy.mjs reconcile accept 'Verified both services and backups; target version is deployed.'
systemctl --user start kommutator-release-deploy.timer
```

Keep retained clones while their daemon is running; the daemon's code and dependencies live
there. Do not restore a backup or downgrade a schema automatically. Port publication remains
127.0.0.1:8787; existing Windows LAN ingress is unaffected. Actual Windows reboot, physical
subnet and day-long usage remain separate acceptance gates.
