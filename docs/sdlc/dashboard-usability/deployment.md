# Dashboard 0.8.0 installed validation

Observed on 2026-11-02 in the existing Docker/WSL installation. Release
[v0.8.0](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.8.0)
was published from `e8e4ba92ac8637b5de78259f3ba0c72b246aeadb` and merged through
[PR 1](https://github.com/alex-voloshin-dev/kommutator/pull/1).

## Deployment and recovery

The supported local updater completed with checkpoint `idle`, applied version `0.8.0`,
and no error. The Docker image `kommutator-hub:release-0.8.0` is healthy. After the
cleanup restart, agentd reported version 0.8.0, runtime contract 3, hub connected,
healthy state, and an empty outbox. The existing developer root identity survived.
Feedback observer, maintainer and release-deploy timer are enabled and active again.

Before this upgrade, the 0.7.1 updater health gate was blocked by one intentionally
rejected synthetic whitespace-topic join left in the local daemon outbox. The daemon
database and exact failed row were backed up privately; only that permanently failed
test row was removed. Running 0.7.1 services were verified healthy, then the supported
reconciliation command accepted the completed deployment. No real queued work was deleted.

## Live cleanup

With maintenance paused and the hub stopped, an exact-ID manifest selected the same
closed synthetic data set as the rehearsal. A fresh dry run matched its fingerprint.
Apply created a private `VACUUM INTO` backup before removing:

| Records | Removed |
| --- | ---: |
| Ended test sessions / registrations | 14 / 14 |
| Test messages / targets / deliveries | 32 / 32 / 48 |
| Test topics / isolated hosts | 3 / 2 |
| Memberships | 28 |
| Board entries / versions | 5 / 6 |

Every retained row and value in all ten affected tables was compared with the backup
while the hub remained stopped: identical. SQLite integrity and foreign-key checks
passed. Repeating apply returned `replayed: true` and zero deletions. Replay tombstones
remain; local client caches and observer history were not erased. The backup and exact
manifest remain outside the repository in the operator's private state directory.

## Browser and release evidence

Authenticated Chromium against the restarted live hub passed: all eight retained topics
rendered, subscriber disclosure opened, pause/manual refresh/resume worked, selected test
session/topic IDs were absent, and the existing developer root was present. No page errors
occurred. Credentials stayed in memory; no production screenshots or message bodies were
published. Synthetic browser evidence is in this directory.

Final release-commit CI succeeded: release checks 41555807226, branch checks 41555898236,
PR checks 41555902609; secret scans 41555807195, 41555898260 and 41555902597. All four
published runtime assets matched their local bytes when anonymously downloaded.

Two additional local final-artifact E2E attempts hit the existing Claude hook deadline;
this is not recorded as a pass. A temporary instrumented artifact copy measured one
SessionEnd import at 135.20 ms, input at 140.50 ms and deadline exit at 148.27 ms before
IPC; another reached IPC at 131.58 ms and deadline at 140.75 ms. Source assertions and
deadlines were not relaxed. See [release validation](release.md) for the complete boundary.
External-subnet, reboot and day-long acceptance were not rerun for this dashboard change.
