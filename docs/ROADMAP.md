# Current roadmap

Updated 2026-11-12. Released baseline: [0.12.5](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.12.5).
This roadmap separates implemented behavior, remaining acceptance and deferred product work.
Historical task order remains in [MVP_PLAN](MVP_PLAN.md); current recovery and scope decisions
are in [DESIGN §17–19](DESIGN.md). Observed execution is recorded in [spikes/RESULTS](../spikes/RESULTS.md).

Issue #15 is complete in 0.12.3: deterministic reset regression, independent reviews,
full release qualification and ordinary local updater completion are recorded in
[RESULTS](../spikes/RESULTS.md). The previous chat MCP was compatible 0.12.2;
clean-profile installed MCP probes verified 0.12.3.

## Current release qualification

Published 0.12.5 supersedes the unpublished immutable 0.12.4 draft. It fixes MCP
stdin EOF cleanup, including late resources from in-flight handlers, isolates the
canonical hello schema for hook authority, and preserves lifecycle test failures
when cleanup also fails. Independent review and final qualification passed:
584 workspace tests, 140 script tests, export verification, clean-PATH smokes and
synthetic E2E. Branch, PR and tag CI passed on the exact release commit. Anonymous
asset downloads matched pinned hashes; real Claude/Codex CLI installs into clean
profiles and installed MCP/private-setup probes passed. The ordinary updater
deployed local hub and daemon 0.12.5, with healthy connected caller, empty outbox
and both private database backups passing quick_check. The updater timer is active.

Earlier semantic registration failures remain recorded in RESULTS; their cause is
not established. Issues #9 and #19 stay open. The restarted chat MCP is 0.12.3;
the live chat MCP remains compatible with daemon 0.12.5. Installed-probe MCPs
are 0.12.5; this does not hot-reload the existing chat process.

Candidate 0.12.6 implements bounded waiting for an already accepted matching manual
Claude registration. Its baseline-failing regression and real delayed-registration
control pass, and final qualification passed 603 workspace + 140 script tests plus
export smokes/E2E. Earlier untraced 375 ms/no-hello failures are retained; #9 and
unproven #19 triggers remain open. Publication/local rollout are not yet observed.

## Immediate maintenance

| Priority | Work | Completion evidence |
| --- | --- | --- |
| 1 | [#19: intermittent lifecycle registration fixture failure](https://github.com/alex-voloshin-dev/kommutator/issues/19) | Controlled delayed-local-registration experiment reproduces the exact error below 200 ms; hub-only delay does not. Capture daemon queue/process-birth/local-save phases in CI; original trigger remains unknown. Preserve deadlines, fences and single attempts |
| 2 | [#9: hook startup latency](https://github.com/alex-voloshin-dev/kommutator/issues/9) | Natural traced 207.380 ms sample measured 54.349 ms main-thread scheduler wait; untraced 310.501 ms cause unknown. Capture equivalent CI phase evidence; retain the temporary 300 ms cap, 200 ms target and unchanged 140/90 ms internal timers |
| Ongoing | Feedback and release maintenance | Investigate substantive feedback, preserve receipt semantics, validate fixes and announce qualified releases in `kommutator-feedback`; deploy and verify the local hub and daemon under the existing maintainer authorization |

The earlier unread replay report has no established root cause: the reporter cleared the
backlog with complete IDs but lost the unsuccessful call arguments. Version 0.12.1 added
acknowledgement counts; it did not prove that report fixed. Reopen investigation with the
exact caller, message IDs, arguments and returned counts if it recurs.

## Implemented and qualified baseline

| Area | Observed state | Remaining acceptance |
| --- | --- | --- |
| Core and identity | Hub, daemon, MCP/hooks, boards and dashboard; live macOS two-Claude native exchange; same-host identity and resume fencing; 0.12.2 durable retirement recovery and pre-enqueue address validation | Preserve these contracts; synthetic recovery coverage is separate from every vendor/environment combination |
| Toolchain | Node 26.13.0 and pnpm 12.18.0 pinned; Linux x64 source, bundled runtime and local Docker deployment qualified | Execute other supported target platforms before claiming their bundled runtime support |
| Operability | Doctor/status, bounded logs, dashboard filters/freshness and topic/subscriber visibility; durable outbox and nonblocking compatibility diagnostics | A recorded full day of real use without manual database repair; capacity measurements |
| WSL/Docker | Persistent isolated hub, private key/database, local release updater with backups and health gates; hub/daemon 0.12.5 deployed; #15 restart fix completed the ordinary updater path without manual recovery | Actual Windows reboot/logon recovery remains open. The earlier emergency-host recovery is not unattended reboot acceptance |
| Codex integration | Per-call root metadata, hooks, exact-hash trust, mixed-vendor exchange and hub restart recovery; current session MCP 0.12.3 verified | Actual Work desktop UI and native idle wake; hook delivery does not establish native wake |
| LAN | Fixed port 8787; opt-in single explicit subnet; effective-rule and host-local checks observed | Independent physical allowed- and denied-subnet clients; WSL NAT/host-local probes cannot substitute |
| Client distribution | Public GitHub marketplace, immutable Linux x64 release assets, anonymous hash verification, real Claude/Codex CLI installation and MCP/private-setup probes through 0.12.5 | Record real model exchange after manual-to-plugin migration; execute other OS/architecture artifacts |
| Publication | Public MIT repository, secret scanning and hosted CI; versioned client releases and local hub images | Public GHCR hub image and official vendor catalog submissions remain separate work; no npm or official marketplace approval is implied |

## Acceptance work that needs a suitable environment

- Run and record a day-long use window with reconnects, session lifecycle, queued sends and
  receipts. Short smoke tests do not close this gate.
- Exercise Windows reboot/logon at a planned interruption window, verifying WSL, Docker,
  hub, daemon, persistent state and subnet restrictions after restart.
- Verify LAN allow/deny behavior from separate physical clients; no such test machine was
  available in the last recorded check.
- Exercise actual Work desktop/native idle wake and real plugin-migration conversations.
  Clean-profile installer and synthetic-client tests do not prove these behaviors.
- Measure capacity and resource limits with isolated disposable sessions/messages, keeping
  production history and replay safety intact.

## Later distribution and product work

After the reliability work above, prepare a versioned GHCR hub publication path with
image verification and simple installation instructions, then vendor catalog submissions
and additional platform execution. These are planned deliverables, not current availability.

Native Windows clients, cloud Work, Copilot and broader network access remain outside
current support. Per-host credentials/revocation, rate limits, retention/pruning, claims,
Postgres and other deferred subsystems remain design work in [DESIGN §18](DESIGN.md#18-deferred-cut-in-the-review-kept-as-notes).
Pruning stays disabled until replay-safe behavior is designed and qualified. No broader
network exposure is authorized by completing local or single-subnet acceptance.
