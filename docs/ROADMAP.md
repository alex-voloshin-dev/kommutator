# Current roadmap

As of 2026-10-31. Historical task order and exact acceptance criteria remain in
[MVP_PLAN](MVP_PLAN.md); [DESIGN §17–19](DESIGN.md) records scope and decisions.

| Area | Observed state | Remaining acceptance |
| --- | --- | --- |
| M1 core | Hub, daemon, shim/hooks, boards, dashboard and live macOS two-session native wake passed | No reopening of closed scaffold reviews |
| Operability | Doctor/status, bounded log following, dashboard filters/freshness implemented | Day-long real use |
| WSL/Docker | Three live Claude sessions, 22 messages, board and exit survival observed | Reboot/logon and capacity limits |
| M2 Codex | Independent root metadata, hooks, exact-hash trust, mixed-vendor exchange, hub restart recovery | Actual Work desktop UI and idle native wake |
| LAN | Opt-in single-subnet helper; effective-rule and host-local endpoint checks observed | Separate physical allowed/denied-subnet clients; WSL NAT cannot substitute |
| Plugin distribution | Local Linux x64 loader/setup and synthetic artifact evidence | Real exchange after manual-to-plugin migration; other OS/architecture execution |
| Publication | Public MIT source, anonymous clone, initial-history secret checks and hosted CI passed | Client binary releases, GHCR image and vendor listings remain separate |

Do not infer public marketplace approval, npm availability or a hosted release from local
artifacts. macOS source evidence does not qualify exported macOS bundles. Native Windows,
cloud Work, Copilot and broader network access remain outside current support.

Prune/replay horizons, stronger per-host identity, rate limits, claims and other deferred
subsystems remain design work, not prerequisites for this scoped publication preparation.
