# Target acceptance — WSL2 hub / WSL2 or macOS client

Status: **remote LAN target not run; local WSL checks passed on 2026-10-27**.
See [three-agent Docker run](../wsl-live-load/implementation.md) for local native wake,
messages, board and client-exit evidence. The unfilled rows below refer to the broader
remote-client scenario; preparation checks on macOS do not satisfy it. Never paste a hub key, vendor token or private config here.

## Environment

- Date and start/end time (UTC):
- Hub WSL distribution, kernel, networking mode and architecture:
- Selected physical LAN interface, address/prefix and single allowed CIDR:
- Published endpoint (default TCP 8787), forwarding path and firewall scope:
- Hub Node / pnpm versions:
- Client Windows version, WSL version, Ubuntu release and architecture:
- Client Linux Node / pnpm / Claude versions:
- Manual or bypass launch; if bypass, explicit per-session inbound policy:
- Hub smoke result in WSL (local smoke passed; see local-hub-readiness/onboarding.md):
- Full workspace tests and hub smoke result in WSL:

## Results

| Check | Result / observation |
| --- | --- |
| Dashboard reachable from allowed-subnet client on TCP 8787; missing key rejected | Not run |
| Outside-subnet source denied even with a valid key; no alternate IPv6 exposure | Not run |
| Client doctor authenticated hub and local IPC pass | Not run |
| Two Claude sessions have distinct vendor/session IDs and handles | Not run |
| Same project board/topic on both clients | Not run |
| Idle session receives native peer message and starts a turn | Not run |
| Reply uses the original thread | Not run |
| New board test marker visible with the same version/body | Not run |
| Handoff visible on project board | Not run |
| Session exit leaves remaining session/daemon operational | Not run |
| Hub restart restores connectivity and drains queued messages once | Not run |
| No manual SQLite inspection needed | Not run |

Overall: not run / passed / failed / partial
Failures, exact sanitized commands/errors and relevant log excerpts:
Follow-up required:

Full-day operability observation is tracked separately using [OPERATIONS.md](../../OPERATIONS.md#step-7-day-long-acceptance).
