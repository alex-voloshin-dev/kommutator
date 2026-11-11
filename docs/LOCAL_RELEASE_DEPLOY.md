# Optional local release deployment

The hub and shared client daemon are different processes. Updating a plugin does not replace
an already running agentd. The optional timer applies qualified published versions to both
services on a trusted Linux x64 host. It uses the existing default Docker deployment, private
key, database and `~/.kommutator` state. It does not change vendor installations or profiles.

This is disabled by default. The operator must explicitly authorize local service restarts;
a feedback message or release alone cannot grant that permission. Prereleases marked in
GitHub are included when their tag is numeric `vMAJOR.MINOR.PATCH`. Semver suffix tags are
not supported. Node 26.13.0, pnpm 12.18.0, gh authentication, git, flock, Docker Compose and access
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

## Historical transition from the pnpm 10.18.0 updater

This records the earlier pnpm 10 migration. For current deployment, follow the Node 26
cutover instructions below; do not install this historical toolchain.

Before publishing the first release that requires pnpm 10.34.9, refresh any installed
updater from a reviewed, trusted checkout containing the new source-validation gate.
The old updater requires `packageManager: pnpm@10.18.0`; installing a newer pnpm binary
alone does not update that gate and the new release would leave its attempt blocked.

1. Stop the timer with `systemctl --user stop kommutator-release-deploy.timer` to prevent
   another scheduled attempt. Inspect `systemctl --user status kommutator-release-deploy.service`
   and allow an active oneshot to finish before changing its checkout or toolchain. Do not
   kill it just to upgrade the updater. Confirm that the private state's `update.lock` is
   free, including any manually started updater, and prevent concurrent manual runs during
   this maintenance window. Stopping the timer alone does not drain an active service.
2. Inspect the updater's status, retained attempt logs and actual running service versions.
   Preserve the checkpoint and backups. If an earlier attempt is `working` or `blocked`,
   investigate and reconcile it using the procedure below; do not erase state to bypass
   the block or accept an unverified deployment.
3. Point the service's `WorkingDirectory` and `ExecStart` at the reviewed updater checkout
   and explicit Node 24 executable, then run `systemctl --user daemon-reload`. Install or
   provide pnpm 10.34.9 through the service's existing PATH. Check `pnpm --version` and
   executable resolution using the service's configured user, PATH and working directory;
   an interactive shell's pnpm version is not sufficient. Keep the service's existing
   permissions and access restrictions.
4. Preserve the old checkout and retained release clones while any running daemon uses
   their code or dependencies. Verify the new updater's status and source gate, then
   restart the timer with `systemctl --user start kommutator-release-deploy.timer` only
   after the checkpoint is reconciled and the toolchain checks pass. Publishing and
   authorizing the subsequent service deployment remain separate operator actions.

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


Tracked source modes are normalized to Git's regular/executable modes inside the private
attempt directory before Docker COPY. The built image must pass actual non-root startup and
healthcheck with a synthetic key and isolated tmpfs database before any production downtime.
This catches runtime permission failures that a root build-stage import cannot detect.


## Node 26 runtime cutover

The Node 26.13.0 / pnpm 12.18.0 migration uses:

```sh
node scripts/local-release-deploy.mjs cutover --expected-version 0.12.0 --expected-commit <qualified-40-hex-commit>
```

Both constraints are mandatory; ordinary `run` keeps its existing release-selection behavior.
The exact published candidate, resolved commit, latest CI, downloaded asset checksums,
source catalogs and runtime metadata must match before backup or activation. A newer
unrelated release cannot replace the selected candidate. Preparation failures retain a
blocked attempt; reconcile only after inspecting services and retained recovery material.

After qualification and before publication, stop the timer, drain an active oneshot and
verify the updater lock is free. Retain the checkpoint and old runtime. Stage the trusted
new updater with its `scripts/lib/` dependencies and `scripts/verify-plugin-export.mjs`.
Use the verified private Node 26.13.0 executable (including its LICENSE and libatomic
prerequisite); install exact pnpm 12.18.0 in a private prefix. Node 26 does not bundle
Corepack. Asset verification requires Python 3.12 or newer (tarfile data filter), and runs
during preparation before downtime. The qualified npm bootstrap is `npm install --global --prefix <private-prefix>
--ignore-scripts pnpm@12.18.0`; platform optional dependencies supply the native executable.
Verify Node's absolute path/version and pnpm's effective 12.18.0 version in the service
PATH and candidate cwd: pnpm follows a project's packageManager pin. Update the service's
absolute Node entrypoint and PATH, then daemon-reload while the timer remains stopped.
Invoke cutover only with the qualified version and commit; keep polling quiescent through
activation and actual hub/daemon runtime verification. Restore the timer only after success
or explicit failure reconciliation. This runbook does not grant deployment authorization.
