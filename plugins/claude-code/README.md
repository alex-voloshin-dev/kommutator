# kommutator plugin for Claude Code

For normal installation use the [bundled client guide](../../docs/INSTALL.md).
This file describes the advanced source/manual alternative. Before running commands below,
complete its private connection configuration and make Node 24 and `kom` available in the
actual vendor launch environment. Do not combine manual and bundled hooks.


Adds the `kommutator` MCP server, lifecycle hooks and coordination etiquette. The M1
implementation provides fourteen MCP tools and daemon-backed hooks. Real Claude MCP-parent
daemon survival and the full two-session production M1 scenario passed on macOS with
Claude Code 2.1.310: same-cwd identity, native idle wake, threaded reply, board and handoff;
see [the work plan](../../docs/MVP_PLAN.md) and [spike results](../../spikes/RESULTS.md).

## Local setup

Use the project's Node 24 and pnpm 10.34.9 toolchain, build the workspace, and make the built
`packages/cli/dist/index.js` available as `kom` on the PATH inherited by Claude. The package
has not been published. Do not install this plugin into an unrelated coding environment.

With the hub already running and `KOM_KEY` exported in the setup terminal:

```bash
kom init --hub http://127.0.0.1:8787 --no-hooks
claude --plugin-dir /absolute/path/to/kommutator/plugins/claude-code
```

`--no-hooks` avoids duplicating the plugin's hooks in `~/.claude/settings.json`. Without it,
`kom init` merges this integration's exec-form hooks idempotently and preserves unrelated
settings. It never enables `crossSessionInbound` globally or in repository configuration.
The config key is stored in `~/.kommutator/config.json` with mode 0600 and is never printed.
`KOM_HOME` selects a different daemon config/state directory for disposable local runs.

M1's explicitly supported bypass setup requires per-session inbound acceptance. Launch it
with both the actual vendor setting and the host-local marker that reports this choice to
kommutator:

```bash
KOM_CLAUDE_INBOUND_POLICY=accept claude --dangerously-skip-permissions \
  --settings '{"crossSessionInbound":"accept"}' \
  --plugin-dir /absolute/path/to/kommutator/plugins/claude-code
```

The marker alone does not change Claude's policy. `accept` permits inbound peer messages for
that Claude session; it does not establish user consent for their contents. Claude Code
2.1.310 manual/default and bypass/explicit-accept external delivery were observed in the
spike; bypass/default was Held. No silent fallback counts as native-wake acceptance.
SessionStart can omit permission mode; the daemon preserves it as unknown until observed.

## Hook behavior

Hooks use exec form (`"command": "kom", "args": [...]`) so the hook's parent pid is the
vendor process, rather than a shell wrapper. `SessionStart` registers the vendor identity,
socket and token. `UserPromptSubmit` and `PostToolUse` inject oldest unread headers.
`Stop` blocks once per user-turn idle cycle only for waking messages and when wake is on;
`stop_hook_active` re-entry never blocks. PostToolUse does not reset the Stop guard.
`SessionEnd` queues the session end.

If the plugin was installed during a conversation, run `/exit`, then run `claude --resume`
in a terminal in the same project and select that conversation (retain `--plugin-dir` for
this manual integration). Trust the updated plugin hooks so `SessionStart` can register it.
`/reload-plugins` alone is insufficient: `UserPromptSubmit` consumes an existing registration
and cannot create one. `setup_status` configuration and daemon compatibility do not prove
session registration; verify with `whoami` after resuming.

Each invocation has a total process deadline below the 200 ms budget, including stdin.
Missing daemon: spawn detached and return empty output immediately. Malformed/empty input,
slow IPC and unavailable hub fail open. Header output is capped by `packHeaders` to five
headers and 4000 code points; only successfully written headers are acknowledged. If the
acknowledgement then fails, duplicate headers are possible and unseen messages remain unread.
Socket writes and closes never mark messages read.

The MCP shim lazily starts the daemon, binds through `CLAUDE_CODE_SESSION_ID`, and reconnects
on subsequent calls after a daemon restart. An ambiguous session identity is an error.
`send` returning `queued` is durable local acceptance: do not send the message again.

## PATH and platform

`kom` must be on the PATH Claude sees, including GUI-launched sessions. If needed, replace
`command` with an absolute executable path in the plugin's hooks and MCP declaration.
`kom doctor` and `kom logs -f` are implemented; see [operations](../../docs/OPERATIONS.md).
For a Windows machine, run the client entirely inside WSL2 with Linux Node and Claude;
see [Windows hub / WSL2 client setup](../../docs/WINDOWS_LAN_SETUP.md). Native Windows
client IPC, process identity and exec-form hooks still need implementation and live checks;
changing only the executable path does not make that client supported.
