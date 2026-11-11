# Codex / ChatGPT Work local integration (M2)

For normal installation use the [bundled client guide](../../docs/INSTALL.md).
This file describes the advanced source/manual alternative. Before running commands below,
complete its private connection configuration and make Node 26.13.0 and `kom` available in the
actual vendor launch environment. Do not combine manual and bundled hooks.


This integration provides a root-session mailbox through MCP and local command hooks.
Capability is `hook`: messages wait for UserPromptSubmit, PostToolUse or the one-shot
Stop poll. Idle native wake is not enabled; it requires the separate app-server spike.
Cloud-orchestrated Work threads and native Windows clients are outside this support scope.

With private hub/key configuration already created using the installation guide, build
with Node 26.13.0 and pnpm 12.18.0. Ensure `kom` and Node resolve in the target app's
actual launch environment, then opt in:

```sh
kom init --vendor codex
codex mcp add kommutator -- kom mcp
```

`kom init` uses the existing private daemon configuration/key, merges only this integration's
entries into `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`), and preserves unrelated
hooks. Use `--codex-hooks <path>` for a project file. It does not alter config.toml, trust,
feature flags, model permissions or Claude configuration. Review and trust the hooks via
`/hooks`; verify hooks are not disabled by configuration overrides. Do not install the same
hooks globally and in the project: duplicate invocations can duplicate injected context.

Start a fresh **independent root session**, then call `whoami`. Copy the etiquette from
[AGENTS.md](AGENTS.md) into the target project's instructions as appropriate. The first MCP
call registers the root; a SessionStart hook that runs before it safely does nothing.
Use `kom doctor --codex-hooks <path>` to inspect hook wiring and observed runtime polls.
The doctor never executes hooks or changes configuration. Its runtime result distinguishes
registered/live shims from PostToolUse/Stop polls observed since the daemon started.

## Identity and lifecycle

The shim uses transport `_meta.sessionId` and `_meta.threadId` on each MCP tool call, not
model-supplied arguments or inherited environment IDs. Independent roots in the same cwd
remain distinct even when they share an app-server PID. Each root gets a separate pinned
IPC connection; an MCP process supports up to 128 roots before requiring a restart.
Missing/conflicting metadata is an error. Fork/subagent MCP calls whose thread ID differs
from the root session ID are rejected; use independent root sessions to collaborate.

Codex hooks identify the root from the JSON `session_id`. They require the explicit
`--vendor codex` command marker and never replace shim liveness with a transient shell PID.
Hook mailbox scope is the **root session tree**: Codex can report the parent's session ID
for subagent hooks, so these hooks do not establish separate subagent mailboxes or isolation.
Headers acknowledged by a hook were shown in that tree, not necessarily to the parent model.
`SessionEnd` (main-thread event) ends the mailbox; shim PID/birth checks cover process death.
A shared MCP process staying alive without a SessionEnd event cannot prove that a thread
ended. Switching threads is not an end event.

Hook errors fail open with empty stdout and exit 0. The 140 ms entrypoint timer and 90 ms
IPC timeout remain unchanged; full-process tests temporarily allow <300 ms while reporting
the original 200 ms target (DESIGN §19 / issue #9). A message
header is acknowledged only after its output is flushed. The Stop poll respects DND/FYI,
hop limits and the one-shot latch. Peer messages never supply user consent.

## Evidence boundary

The installed Codex CLI 0.164.0 was probed with two same-cwd roots and an independently
launched app-server; call metadata, hook payload identity and Stop re-entry were observed.
See [the recorded spikes](../../spikes/RESULTS.md) for exact versions and production test
results. Local ChatGPT Work shares this engine interface; successful CLI/standalone-server
checks do not by themselves verify an actual Work desktop UI thread. Native wake remains
gated separately.
