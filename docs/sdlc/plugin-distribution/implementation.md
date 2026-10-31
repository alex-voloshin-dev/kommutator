# Bundled local plugins and private onboarding

Implemented and checked on 2026-10-28 (America/New_York; some evidence timestamps are
2026-10-29 UTC). Scope follows the user's explicit correction: installing a client plugin
must not require a separate manual Node or kom installation.

## Delivered behavior

The export command packages Node 24, a standalone bundled application, third-party
licenses, Claude/Codex manifests, hooks, a shared coordination/setup skill, two local
marketplace catalogs and checksums. The MCP launcher verifies and atomically copies an
immutable runtime outside plugin caches. Both vendors reuse the user's private config
and daemon. No startup network download, package-manager installation, automatic daemon
replacement, vendor trust bypass or public publication occurs.

An unconfigured MCP remains available. `setup_start` opens a five-minute private loopback
form for the hub URL, suggested host name and password-masked key. Credentials never
enter tool arguments or results. The form validates an authenticated hub snapshot and
atomically creates a 0600 config; existing config is reused, never overwritten.
`setup_status` also reports daemon compatibility. Missing/incompatible older daemons
have distinct states; an active old daemon requires the explicit bundled management
command after ending active sessions. See [build/install instructions](BUILD.md).

Plugin identity is explicit. Exact Codex root metadata maps to independent IPC clients;
project context comes from immutable private SessionStart observations, not plugin-cache
cwd or inherited Claude variables. Cold Claude registration replays validated observed
hook facts only while the original parent PID/birth remains alive. Snapshot credentials
stay private and are removed on SessionEnd. Conflicting live owners are rejected.

Before session operations, a bounded read-only readiness check permits hub reconnection
after daemon restart. It does not retry session calls or mutations, and offline sends
remain queueable. Older manual hook/MCP entries are detected without rewriting settings.

## Verification

| Check | Observed outcome |
| --- | --- |
| Independent build/typecheck/full suite | Passed, 324 tests: protocol 30 + hub 141 + agentd 50 + CLI 103 |
| Exported clean-PATH smoke | Both plugins initialize MCP and expose 16 tools without system Node/kom; setup, immutable runtime reuse and cache removal passed |
| Exported synthetic E2E | Cold Claude first whoami; two same-cwd Codex roots; independent identity; cross-vendor send/read/reply; topics/board; immutable cwd; cache removal; survivor and daemon restart passed |
| Reconnection regression | Deterministic 200 ms delayed hub WebSocket upgrade after daemon restart passed |
| Actual hub outage | Exported send returned queued with outbox depth 1; no mutation replay added |
| Chromium 156 form | Wrong key rejected without config creation; valid key saved 0600; existing config reused; no key in MCP transcript/logs |
| Installed Codex 0.164.0 | Local marketplace installation, MCP connection/16 tools, normal exact-hash trust for all five hooks, two root contexts with correct cwd and 0600 passed |
| Installed Claude Code 2.1.310 | Actual plugin/MCP loading and SessionStart project-context recording passed |
| Reviews | Independent correctness and security approved; QA green. Optional external helper produced no parseable review and supplied no approval |

Vendor loader runs used isolated HOME/config directories. Codex turn/start was used to
trigger trusted hooks without account authentication; the subsequent model request was
unauthorized. This is evidence of hooks and loader behavior, not a completed model turn
or live plugin-to-plugin conversation. Messaging E2E above uses synthetic vendor-shaped
hooks and real exported processes. Existing earlier M1/M2 live evidence remains separate.

Sources: [Codex evidence](../../../spikes/evidence/2026-10-28-plugin-codex.json),
[Claude evidence](../../../spikes/evidence/2026-10-28-plugin-claude.json),
[browser evidence](../../../spikes/evidence/2026-10-28-plugin-browser.json),
[browser success](../../../spikes/evidence/2026-10-28-plugin-connected.png).

After integration into the main checkout, build/typecheck and exported smoke passed.
One first suite run alongside typecheck/archive work measured the existing Codex
stdin-deadline test at 200.082 ms against its strict 200 ms assertion. No assertion or
deadline was relaxed; a full rerun without the competing build/archive jobs passed all
324 tests. This remains wall-clock scheduling evidence, not a hard real-time guarantee.
All 412 exported files matched their checksums after delivery. The local directory is
`.artifacts/plugin-distribution/linux-x64`; its archive is
`.artifacts/plugin-distribution/kommutator-linux-x64-local.tar.gz` (ignored build output).

## Defects found and corrected

Real Codex 0.164 does not expand plugin-root variables in MCP arguments. The exported
legacy manifest now uses a plugin-relative executable and cwd; hook expansion was
verified separately. Dereferencing a deployed pnpm graph broke dependency resolution;
standalone bundling replaced it. Browser POST used Origin null under no-referrer;
same-origin referrer policy fixed the actual form while retaining foreign/null-origin
rejection. Cold Claude required replaying observed registration. Restart occasionally
preceded hub readiness; read-only bounded readiness probes fixed the demonstrated race.

## Remaining boundaries

Only this Linux x64/WSL artifact is tested. macOS export inputs are supported but not
executed here; native Windows, cloud Work, desktop UI acceptance, Copilot and other
vendors are not enabled by this change. Public publishing still requires the project
license decision and vendor distribution requirements.

Direct exported hook-process measurements were approximately 89–100 ms; the actual final
Claude loader reported 126 ms. Codex's full vendor-reported SessionStart took 749/751 ms
and UserPromptSubmit 722/730 ms. The internal fail-open deadline is retained, but this
does **not** establish a 200 ms end-to-end Codex hook bound. Vendor overhead attribution
has not been isolated. A hard process kill while holding a snapshot lock may require a
fresh root session. The normal OS ps utility remains necessary; Node/kom do not.

Codex can filter custom KOM_HOME out of MCP child environments. Normal installation uses
the shared default home; custom test overrides must be set consistently for MCP/hooks.
Migration of this machine's existing manual integration was not performed. The Docker
hub, LAN firewall, shared key and current client settings remain as before this task.

The source-transfer checkout was preserved: development used an isolated snapshot,
reviewed source changes were copied back, and no Git initialization/commit/publication
was performed. See [final review](review-code-2.md). The next integration step is a
controlled migration from the existing manual setup and a live conversation using the
installed packages; Copilot requires its own identity/loader qualification.
