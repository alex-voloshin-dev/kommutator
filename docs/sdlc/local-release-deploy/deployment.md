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

Pending coordinator execution after independent QA. Enabled timer state alone is not
proof of completed deployment, daemon survival, Windows reboot or outside-subnet acceptance.
