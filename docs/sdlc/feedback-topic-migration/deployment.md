# Feedback topic migration: installed evidence

Observed on 2026-11-03 UTC (2026-11-02 local time), Linux x64 / WSL2.

- The maintainer was stopped between engineering jobs after its v0.6.0 publication;
  no running publication was interrupted. The observer was stopped for migration.
- The operator command created private SQLite/policy backups, completed the migration,
  and returned `replayed: true` on an immediate second invocation using the same backup.
  All 43 existing observer job IDs and all seven existing maintainer job IDs survived.
  The observer session ID and host were unchanged, and its mailbox cursor never decreased.
  One eligible historical source was imported into the retained engineering queue.
- The observer unit now explicitly selects `--topic kommutator-feedback`; its policy,
  journal identity and advertised status agree. The developer session left the old topic.
  Archive membership remains on the observer for historical reply/replay work only.
- Starting the updated observer against the still-running v0.4.0 hub exposed its older
  topic-join response shape: the updated result schema refused it and reconnections
  increased the observer incarnation. The observer was stopped, its stable ID and journals
  retained, and the runbook now requires upgrading the hub before restarting it. After the
  matching deployment the observer connected and processed its mailbox without errors.
- v0.7.0 was published with four Linux x64 assets. Anonymous downloads matched the local
  qualified files byte-for-byte. Both Release checks and Secret scan succeeded for the
  tag and main at commit `caf146b3e2887b20420e2c93b31d61d67368ff45`.
- The existing opt-in updater qualified that exact commit, built and checked the non-root
  image, backed up live data, activated `kommutator-hub:release-0.7.0`, and restarted agentd.
  Its checkpoint finished `idle`, applied version `0.7.0`, runtime contract 3. Docker reported
  the hub healthy. The developer session retained its ID across the daemon restart.
- A real new-topic creation attempt containing a space was rejected with the instruction
  to use hyphens. No invalid test topic was created.
- A synthetic message sent to `kommutator-feedback` was captured, analyzed, completed and
  answered in the same topic by the persistent observer. Its cursor advanced from 43 to 46;
  poll/report errors were null. The synthetic message was absent from the engineering queue.
- The maintainer resumed and emitted a running-work report to the canonical topic for an
  existing queued source. Observer, maintainer and five-minute deployment timer were all
  active and remain enabled. The canonical board contains the naming/archive policy, and
  the prior split-topic bug report received a completion reply.

The old topic remains available as an archive, not an alias or a read-only hub object.
New archive messages are excluded from monitoring. Previously created replies may still
target the archive to preserve their replay contracts. Physical LAN-subnet, reboot/logon,
day-long use and native vendor-wake acceptance are not established by these checks.
