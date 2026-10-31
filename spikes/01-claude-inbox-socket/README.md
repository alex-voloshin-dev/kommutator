# Spike 01 — post into a Claude Code inbox socket

**Question.** What exact JSON line does Claude Code expect on a session's inbox socket, and is
a post from an outside process (our future agentd) *Delivered* — in a prompting-mode session
without a token, and in a bypass-mode session with the session's token?

**Known from the docs** (`code.claude.com/docs/en/cross-session-messaging`, section
"The session's inbox socket"):

- Each session exports `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` to
  its hooks and Bash commands. `/status` shows the socket as `Peer address` (`uds:` prefix).
- Lines are newline-delimited JSON. An optional first line
  `{"type":"auth","token":"<token>"}` proves the post comes from the session's own child
  (mandatory on Windows). A connection with no complete line within 30 s is closed.
- Inbound controls: a prompting-mode session delivers unverified peer messages; a
  bypass-mode session holds them unless the sender is verified (token) or also bypassing.

**Recorded on 2.1.310:** the working line is `{"type":"user","message":{"role":"user","content":"…"}}`.
See [RESULTS](../RESULTS.md) for evidence and the unresolved bypass result. The adapter
still has its provisional line; production integration is pending.

## Steps

For the full Mac procedure, use [M1_LIVE_RUNBOOK](../M1_LIVE_RUNBOOK.md): it captures
credentials privately, posts without putting tokens in OS arguments, and compares two
real MCP processes. The steps below describe the individual probes.

1. **Get the target session's socket, token and process facts.** Use the private
   SessionStart capture from the runbook in a disposable folder. Do not print messaging
   tokens through the Bash tool or include them in a prompt or shared log.
   Keep that session open and idle. Also check
   `/config` → *Messages from your other sessions* for the `crossSessionInbound` value, so
   a *Held* result can be read correctly.

   **The Bash tool's parent says nothing about a hook's parent** — hooks are spawned by a
   different path. Measure the hook itself: register `./ppid-probe.sh` as a temporary
   exec-form `SessionStart` hook in the project's `.claude/settings.local.json`:

   ```json
   { "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "/Users/<you>/kommutator/spikes/01-claude-inbox-socket/ppid-probe.sh", "args": [] } ] } ] } }
   ```

   Start a new session in that project, then read `~/.kommutator/spike01-ppid.log`: it
   records the hook's own pid, its `$PPID`, the parent's command name and whether the
   messaging socket variable was set — and **no token** (the probe deliberately prints only
   whether the variable exists). If the parent is `claude`, the design's "hook `PPID` =
   session pid" holds; if it is `sh` or something else, note it and the adapter will take
   liveness from the inbox socket only. Remove the hook afterwards.

2. **Discover the message format** (from another terminal; needs Xcode Command Line Tools
   for `file` and `strings`):

   ```bash
   ./discover-format.sh
   ```

   It locates Claude Code's bundled JS (or binary) and prints the `type:` literals near
   `CLAUDE_CODE_MESSAGING_TOKEN` / `type:"auth"` and the field names around them, matching
   both quoted (`"type":"auth"`) and minified (`type:"auth"`) spellings. The message shape is
   a guess until this step — write down what you actually see.

3. **Post.** Try the discovered shape with `--raw`, or iterate the built-in guesses:

   ```bash
   node post.mjs --socket "$SOCK" --text "ping from spike01 — reply with pong" --shape 1
   node post.mjs --socket "$SOCK" --raw '{"type":"message","from":"spike01","text":"ping"}'
   ```

   Watch the target session: a dim `› Message from …` line and a new turn means
   *Delivered*; an approval dialog means *Held*; nothing means wrong format or *Refused*.
   `post.mjs` prints whatever Claude Code writes back on the socket.

4. **Bypass mode.** Restart the target with `claude --dangerously-skip-permissions --name spike-target`,
   repeat step 1, then post twice: without `--token` (expect *Held*) and with
   the private token wrapper. The 2.1.310 run was **Held with and without token** under
   default inbound policy; token possession alone is not own-child proof.

5. Record everything in `../RESULTS.md`, including the Claude Code version (`claude --version`).

6. **Binding question — two sessions, one folder.** The shim must know *which* session
   spawned it, and `cwd` cannot tell two sessions in the same repository apart. Register the
   probe as a temporary MCP server in the project's `.mcp.json`:

   ```json
   { "mcpServers": { "spike01-env": { "command": "node", "args": ["/Users/<you>/kommutator/spikes/01-claude-inbox-socket/env-probe-mcp.mjs"] } } }
   ```

   Open **two** Claude Code sessions in that folder (`--name a`, `--name b`). Preserve
   each SessionStart payload's `session_id` with the private capture in the runbook
   before the next session overwrites the latest capture. The PPID probe logs process
   facts, not the payload/session id, and Bash environment output is not MCP evidence. Read
   `~/.kommutator/spike01-mcp-env.log`: one line per spawned server with every `CLAUDE_*`
   variable name and the values of id-like ones. Record which variable carries the session
   id (`CLAUDE_CODE_SESSION_ID` on 2.1.310), whether it matches the hook's `session_id` in **both**
   sessions, and whether Claude Code spawned one server per session (two lines) or shared
   one. Remove the server from `.mcp.json` afterwards.

## Pass criterion

A line format that is *Delivered* and starts a new turn in an idle session, in prompting mode
without a token and in bypass mode with the token. If bypass mode still holds, the adapter
stays `native` for prompting-mode sessions and falls back to `hook` otherwise — note it.
**And:** a stdio MCP server sees a session-id variable that equals the hook's `session_id`,
separately for two sessions in the same folder. If no such variable exists, the shim must
fall back to parent-pid matching (DESIGN §9) — record the shim's `ppid` from the log and
whether it equals the session's pid from `ppid-probe.sh`.
