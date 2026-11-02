---
type: review
target: local-release-deploy
iteration: 3
verdict: approve
findings: []
---

# Local release deployment review

Independent correctness/security review approved the final implementation. Findings corrected
before approval included a nonexistent protocol export, absent stop-signal forwarding,
insufficient default deployment isolation validation and checkpoint fsync durability.

Review verified fixed repository and exact-commit CI gates; pinned staging and pre-activation
backups; version and health verification; blocked recovery without blind retry; active-child
abort handling and successful detached daemon survival; and narrow observer error clearing.
The reviewer ran git diff --check but no suites or live operations. Independent QA, optional
external review and actual systemd/Docker acceptance are aggregated by the coordinator.

## Round 2 and final gate

External read-only review found that combined stdout/stderr could corrupt successful JSON
responses when commands emitted warnings. The runner now returns only stdout while retaining
both streams in bounded private logs. A real child-process regression verifies this behavior.
A separate actual-service-version guard refuses downgrades before build/backup/activation;
equal-version managed adoption is permitted. Independent source review approved both changes.

QA added and ran behavioral coverage for real wrapper termination and descendant cleanup,
actual built release exports, incomplete latest CI, both live-version downgrade cases and
stderr warnings. All 14 updater tests passed. The implementation engineer ran ordered build,
typecheck and 393 workspace tests, and the observer recovery regression passed. Source Gitleaks
and comparison against local credential values found no secrets. The workflow gate is proceed;
actual service execution is recorded separately in deployment.md.

## Round 3 — private clone Docker permissions

The first actual oneshot run failed: umask 0077 produced private tracked source modes that
Docker COPY preserved as root-owned unreadable runtime files. The new hub failed with
EACCES before startup. The coordinator restored the already verified image of the same
0.4.0 version; no database rollback or downgrade occurred. This attempt was not counted as
successful deployment, and automatic retry remained blocked.

The updater now normalizes only validated Git-tracked regular files and directories to
Git's 644/755 modes beneath the private attempt parent. Symlinks/gitlinks/traversal are
rejected; secrets, Git metadata and untracked directories stay private. The newly built
image must start its actual entrypoint and pass its healthcheck as the deployment UID/GID
with read-only root, dropped capabilities, no network exposure and synthetic tmpfs data/key
before any backup or production activation. A real Docker negative control rejected the
previously broken image with EACCES without touching the live hub.

Independent code/security review approved. QA passed all 16 updater tests, including a real
umask-0077 clone, private-parent preservation and smoke-failure-before-activation. The final
workflow gate is proceed. Actual corrected deployment remains separate operational evidence.
