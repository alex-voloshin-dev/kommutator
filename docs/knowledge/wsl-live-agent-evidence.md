---
title: WSL Docker live-agent evidence
type: note
tags: [wsl, evidence, operations]
---

# WSL Docker live-agent evidence

On 2026-10-27 three real Claude Code 2.1.310 / claude-sonnet-5-5 stream-json sessions
in one scratch WSL cwd used production MCP/hooks/agentd against the Docker hub. Explicit
per-session inbound accept was declared and set; built-in tools were disabled. Distinct
vendor UUIDs matched hub identities. Native idle wake, concurrent ring messaging, shared
board and survival after one session exited passed. No global policy/settings were edited.

The run produced 22 messages (11 matched request/reply pairs), no duplicates/missing replies,
correct thread links and gap-free recipient sequences. All deliveries were marked read;
19 full bodies were explicitly read, including all requests. Three PONGs were only header-marked.
That distinction preserves [[protocol-and-boundaries]] receipt semantics. The shared daemon
remained connected with an empty outbox after session exit. Container stayed healthy.

The default Fable model initially rejected turns for usage-credit exhaustion; Sonnet worked.
This is a model-account constraint, not evidence of a hub failure. Avoid confusing model
inference latency (6.588–11.321 s per complete round trip here) with hub latency (p95 21.66 ms
for a short 200-request authenticated snapshot burst at concurrency 8).

This proves the recorded local WSL/runtime/policy combination only. Remote LAN, interactive
browser/TUI rendering, reboot, full-day real use and saturation remain separate gates.
See [run report](../sdlc/wsl-live-load/implementation.md), [spike results](../../spikes/RESULTS.md),
[sanitized evidence](../../spikes/evidence/2026-10-27-wsl-docker-live.json),
[[docker-hub-isolation]] and [[operability-evidence]].
