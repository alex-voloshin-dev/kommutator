# Current roadmap

Updated 2026-11-13. Released baseline: [0.13.1](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.13.1).
This roadmap separates implemented behavior, remaining acceptance and deferred product work.
Historical task order remains in [MVP_PLAN](MVP_PLAN.md); current recovery and scope decisions
are in [DESIGN §17–19](DESIGN.md). Observed execution is recorded in [spikes/RESULTS](../spikes/RESULTS.md).

Issue #15 is complete in 0.12.3: deterministic reset regression, independent reviews,
full release qualification and ordinary local updater completion are recorded in
[RESULTS](../spikes/RESULTS.md). The previous chat MCP was compatible 0.12.2;
clean-profile installed MCP probes verified 0.12.3.

## Current release qualification

Published 0.13.1 refreshes MCP SDK transitive Hono to 4.13.18 and node-server to 2.1.8.
All seven Dependabot alerts report fixed; full audit reports zero known advisories.
Independent correctness/security/external review, 647 workspace and 140 script tests,
packaging, branch/PR/tag CI, public asset hashes and clean-profile native installations
passed. This is dependency hygiene, not an established fix for availability #22/#25.
Local hub/daemon 0.13.1 are healthy, connected, caller active and outbox empty; backups
passed quick_check and the updater timer is active. Loaded chat MCP remains compatible
0.13.0. See [release notes](sdlc/hono-security-update/release.md).


Published 0.13.0 adds durable owner-scoped send/ack outcome lookup without resubmission.
Independent review and QA, 647 workspace and 140 script tests, integrity, clean-PATH and
exported E2E checks passed. Branch/PR/tag CI, anonymous public downloads/hashes and real
clean-profile Claude/Codex installations passed. Local hub and daemon 0.13.0 are healthy;
backups and schema-4 migration verified, caller active, outbox empty, updater timer active.
At the 0.13.0 rollout the live MCP remained compatible 0.12.6; after client update,
loaded MCP 0.13.0 was verified on 2026-11-13. Clean-profile MCP 0.13.1 was verified separately. See [release notes](sdlc/mutation-reconciliation/release.md).
The first exported E2E timeout is retained in #25; successful repeats do not establish its cause.

Previous 0.12.6 qualification (historical): the release fixes the demonstrated accepted-registration race for unbound manual
Claude shims using a bounded exact-owner wait. It also fences shutdown/disconnect
continuations and adds a separate synthetic CI phase sample. Baseline negative
control fails; the original delayed-registration process control passes without
retries. Final qualification passed 603 workspace + 140 script tests, export checks,
clean-PATH smokes and synthetic E2E. Independent review and branch/PR/tag CI passed.

Anonymous asset hashes, real clean-profile Claude/Codex installs and installed MCP
0.12.6 probes passed. Ordinary updater deployed healthy hub and daemon 0.12.6;
both database backups passed quick_check, current caller is active, hub connected,
outbox empty, timer active. After the chat restart, loaded MCP 0.12.6 and an active caller were verified.

An earlier untraced gate failed with zero hello and a 375 ms cold hook. Its cause
remains unknown. Diagnostic passes and final qualification do not close #9 or prove
all historical #19 triggers resolved. CI now retains queue/birth/local-save/flush
phases and parent/child timing; the first four CI samples measured 89–115 ms.

A [follow-up investigation](sdlc/runtime-reliability-followup/research-brief.md) found
additional green CI samples, an observability gap between the release gate and its
separate phase run, and recurrent local/remote availability failures correlated with
WSL kernel allocation warnings. The [availability incident](sdlc/runtime-reliability-followup/incident.md)
remains open; a healthy short probe is not a root-cause fix.

## Immediate maintenance

| Priority | Work | Completion evidence |
| --- | --- | --- |
| 1 | [#19: intermittent lifecycle registration fixture failure](https://github.com/alex-voloshin-dev/kommutator/issues/19) | Controlled accepted-registration race fixed in 0.12.6; old core fails and delayed process control passes. CI captures queue/birth/local-save phases; original historical trigger and separate missing-generation failures remain unproven. Preserve deadlines, fences and single attempts |
| 2 | [#9: hook startup latency](https://github.com/alex-voloshin-dev/kommutator/issues/9) | Natural traced 207.380 ms sample measured 54.349 ms main-thread scheduler wait; untraced 310.501 ms cause unknown. Capture equivalent CI phase evidence; retain the temporary 300 ms cap, 200 ms target and unchanged 140/90 ms internal timers |
| 1 | [#22: recurrent hub availability](https://github.com/alex-voloshin-dev/kommutator/issues/22) | 0.13.0 adds request-specific send/ack reconciliation, not an availability fix. Correlate simultaneous endpoint/resource/kernel observations; blocked-outbox disposition still needs separate design. No blanket queue deletion or kernel tuning |
| 2 | [#25: exported E2E status timeout](https://github.com/alex-voloshin-dev/kommutator/issues/25) | First 0.13.0 candidate gate timed out on owner-2 set_status despite intact registration. One diagnostic replay passed; retain failed IPC dispatch/response phases before assigning a cause or linking it to #19/#22 |
| 2 | Claude native-wake setup clarity | Field measurements on capability `hook` describe polling latency, not a demonstrated wake regression. Clarify the two per-session policy gates and what accept permits; do not globally enable inbound delivery |
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
| WSL/Docker | Persistent isolated hub, private key/database, local release updater with backups and health gates; hub/daemon 0.13.1 deployed; ordinary updater completed without manual recovery | Actual Windows reboot/logon recovery remains open. The earlier emergency-host recovery is not unattended reboot acceptance |
| Codex integration | Per-call root metadata, hooks, exact-hash trust, mixed-vendor exchange and hub restart recovery; current session MCP 0.13.0 verified | Actual Work desktop UI and native idle wake; hook delivery does not establish native wake |
| LAN | Fixed port 8787; opt-in single explicit subnet; effective-rule and host-local checks observed | Independent physical allowed- and denied-subnet clients; WSL NAT/host-local probes cannot substitute |
| Client distribution | Public GitHub marketplace, immutable Linux x64 release assets, anonymous hash verification, real Claude/Codex CLI installation and MCP/private-setup probes through 0.13.1 | Record real model exchange after manual-to-plugin migration; execute other OS/architecture artifacts |
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
