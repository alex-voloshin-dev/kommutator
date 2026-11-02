# Local release deployment observations

Observed 2026-11-02 on the authorized Linux x64 WSL host.

## Initial recovery

The shared agentd reported version 0.1.0/runtime contract 1 while the installed Claude
plugin was 0.4.0. The installed plugin's `bin/manage daemon restart` replaced it with
0.4.0/contract 3. The daemon reported a healthy hub connection and empty outbox; all nine
session records remained. The existing Codex session retained its ID and role, and its
MCP whoami succeeded after reconnect. No registration was fabricated for Claude.

The installed 0.4.0 Claude MCP setup_status was independently invoked over SDK stdio and
returned `configured: true, daemon: compatible`. A plugin installed mid-conversation still
requires a real vendor SessionStart hook; compatibility does not prove registration or trust.

The contributor checkout was fast-forwarded to published 0.4.0 source. Frozen dependency
installation and build restored the development CLI, which had failed to resolve ws.
Its status command then successfully reported the new shared daemon.

Before Docker replacement, the running hub created an online SQLite backup. The 0.4.0
image was built before recreation; Compose reported healthy, and the container package
version was independently read as 0.4.0. Existing key/data mounts and loopback TCP 8787
publication were preserved. Agentd reconnected and the existing Codex whoami still worked.

The observer's last_poll continued advancing, showing successful capture. A historical
last_error was not being cleared after recovery; the accompanying narrow fix clears only
the capture error after successful capture, retaining unrelated analysis errors.

## Automatic updater acceptance

The first oneshot attempt failed because the 0077 clone modes became root-owned unreadable
files inside the built image. The hub failed with EACCES before startup; the coordinator
restored the previously verified image of the same 0.4.0 version. The queue blocked further
attempts until inspected and explicitly reconciled. No database restore/downgrade occurred.

After the round-three correction, the new isolated image check rejected that broken image
with EACCES without host ports, mounts or production data. The corrected actual systemd run
then completed at 2026-11-02T23:11:20Z: it qualified tag v0.4.0 at commit
9d2a9a5895256b40b3b35f341ce1d7130ea08244, built independent source and image, passed the non-root
entrypoint/healthcheck smoke, created both SQLite backups, recreated the production hub and
restarted agentd from the retained release clone. The checkpoint recorded appliedVersion
0.4.0/status idle and runtime contract 3.

After the oneshot was inactive/success, independent CLI status still showed the same daemon
PID alive, version 0.4.0, contract 3, connected hub, healthy state and empty outbox. Docker
showed kommutator-hub:release-0.4.0 healthy with only 127.0.0.1:8787 published. Existing Codex
MCP whoami succeeded with the original session ID and role (incarnation advanced to 2).

The timer was enabled with five-minute checks. A second real invocation performed no
redeployment: the daemon PID and applied attempt stayed unchanged. The observer continued
polling with last_error and last_report_error null. The installed Claude plugin's setup_status
returned configured true/daemon compatible after the update.

This establishes live local upgrade, same-version deduplication and daemon survival after
oneshot exit. It does not establish Windows reboot/logon, physical subnet or day-long
acceptance, nor registration/trust in the reporting Claude conversation.
