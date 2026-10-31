# M2 Codex hooks and single-subnet LAN implementation

> Public evidence redaction: personal home paths, interface names and network addresses
> are replaced with placeholders (192.0.2.0/24 and 198.51.100.0/24 are documentation ranges).
> They are not deployment instructions or measured endpoint values. Original records are retained privately.

Status: implemented, independently reviewed and QA passed on 2026-10-27.
User request on 2026-10-27 is the plan: implement the accepted one-subnet LAN restriction
and add M2 support for installed Codex / local ChatGPT Work. M1's day-long usage acceptance
remains separate. No upstream feature plan was required.

## Scope and decisions

Assumptions: preserve the Docker hub and existing key/database, TCP 8787, loopback default,
and the M2 hook-mode milestone. Native desktop wake needs separate spike evidence. The
source transfer has no Git repository; work used an isolated temporary source snapshot,
with separate module ownership and scoped integration instead of Git initialization.
The develop workflow delegated implementation, independent correctness/security review,
and QA. Repository Node 24 / pnpm 10.18.0 commands take precedence over stack fallbacks.

Codex tool-call transport metadata selects an independent root, never tool arguments,
ancestor environment IDs, parent PID or cwd. Each root uses a pinned IPC client; missing,
conflicting or fork identities fail explicitly. The first MCP call registers the root;
hooks bind existing roots and never replace shim process liveness. Hook identity denotes
the root session tree, not independent subagents. Doctor distinguishes configured wiring,
live registered shims and hook polls observed since daemon start; it does not infer native
wake or model consumption. No hub wire schema, SQLite schema or dependencies changed.

The LAN helper keeps Docker/WSL publication at 127.0.0.1:8787. Windows IPv4 LAN ingress
forwards to Windows localhost, with the original source checked before forwarding. It
requires an explicit physical interface and matching canonical subnet, rejects conflicting
exposure, verifies effective restrictive firewall rules before opening the proxy, and
removes only owned state. Explicit outside-subnet blocks prevent ordinary broad allow
rules from widening access. IPv6 is not published. Network changes require revalidation.

## Changes

- CLI MCP metadata routing, explicit Codex hook vendor, opt-in hook installer and doctor.
- Daemon Codex registration/binding and read-only observed hook diagnostics.
- Codex plugin setup/etiquette documentation and five-event hook configuration.
- Windows LAN Plan/Apply/Remove helper, pure policy module and deterministic tests.
- DESIGN/PROTOCOL/PLAN, runbook, operations, shared instructions and linked knowledge notes.
- Sanitized runtime evidence and a parameterized disposable M2 reproduction harness.

## Evidence and limits

[RESULTS](../../../spikes/RESULTS.md) records installed CLI 0.164.0 identity and hooks,
two-root standalone app-server behavior, and production messaging/board/Stop/session-exit
acceptance. Existing shared daemon 0.165.0 was not mutated. Windows ChatGPT Classic
1.2026.190.0 process presence was observed; actual Work desktop UI was not tested.

The read-only Windows Plan confirmed REDACTED-LAN, 192.0.2.10/24, exact loopback Docker
publication, localhost HTTP401 and active firewall prerequisites. No elevated Apply/Remove
was performed: this Windows process is not an administrator. LAN remains closed. External
allowed/denied HTTP/WS checks and reboot/logon remain open. Windows may normalize firewall
address filters and cause a conservative idempotence refusal; review the effective plan
rather than weakening the check.

## Validation

- Frozen pnpm install, all workspace builds and typechecks passed.
- Full suite: 305 passed (30 protocol, 141 hub, 50 agentd, 84 CLI).
- QA added real MCP SDK metadata rejection/recovery and ended-root binding coverage.
- 52 deterministic PowerShell policy/rollback tests passed on Windows PowerShell 5.1.
- Read-only Plan passed on the actual Windows interface and Docker publication.
- QA reran the final consolidated production harness successfully: six completed turns,
  three messages, 35 hook events, CAS version 2, one-shot Stop continuation and survivor.
  [Final harness evidence](../../../spikes/evidence/2026-10-27-codex-m2-qa.json).
- Independent correctness and security review approved; two minor doc corrections applied.
  Optional external-review helper returned no usable result and was skipped.
- Temporary hubs, app-servers, daemons and auth symlinks were cleaned after live tests.
  No actual user thread, production hub data or global hook trust was modified by tests.

Round 2 fixed reproduction-harness startup/cleanup and path quoting defects found by the
QA-amendment reviewer. Independent review approved; focused QA passed three injected failure
paths and existing-directory refusal. The earlier real-engine acceptance sequence/assertions
were preserved. Final review: [approve](review-code-2.md).

## Integrated deployment

Scoped source integration completed into the working project. Main-checkout build,
typecheck and all 305 tests passed again. Windows PowerShell reran all 52 policy checks
and the actual read-only Plan successfully from the integrated scripts. Existing Docker
hub remains healthy on 127.0.0.1:8787; no server rebuild or data/key change was needed.

Local WSL Codex setup was installed for new sessions: `kom init --vendor codex` wrote
`~/.codex/hooks.json` and private `~/.kommutator/config.json` using the existing hub key,
with host `wsl-workstation`. Directory mode is 0700; both JSON files are 0600.
`codex mcp add` configured `kommutator` with absolute Node/CLI paths. Existing Codex
configuration was backed up privately under `~/.codex/kommutator-setup-backups/` first.
No global trust, approval policy or hook bypass was enabled. Review/trust the commands
through Codex `/hooks` and start a fresh independent root to load the MCP configuration.

Client daemon status reports healthy, hub connected, empty outbox. Installed doctor has
no failed checks: hook wiring is configured but still warns about trust/runtime loading;
no real production root is registered yet. GUI PATH is unknown on this platform, and no
Claude global hooks were installed. Test evidence above comes from isolated live roots,
not from an already-open desktop UI thread. LAN Apply still needs elevated Windows
PowerShell; the runnable command is in the deployment runbook.

The develop gate returned proceed at iteration 2 (approve plus green QA). Vault links and
final review frontmatter validated. The isolated implementation snapshot was removed after
integration; no Git initialization, commit or publication occurred.



Follow-up: [installed-runtime checks](installed-validation.md) passed exact hook trust, real Codex/Claude
exchange and Docker restart recovery. The earlier manual hook-trust prerequisite is now
satisfied for these unchanged installed commands; desktop UI and Codex native wake remain separate.
