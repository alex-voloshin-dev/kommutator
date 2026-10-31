# Spike 06 — does a detached child survive the agent exiting?

**Question.** Lazy start (DESIGN.md §8) spawns `kom daemon run` from inside an MCP server or a
hook, i.e. as a descendant of the agent process. When the agent exits, does our detached
child keep running? Node's `detached: true` + `stdio: 'ignore'` + `unref()` puts the child in
a new session (`setsid`) on Unix; this spike checks that the agent's process-tree cleanup
doesn't reach it anyway.

## Steps

1. Start Claude Code at the **repository root**. Ask it:

   ```
   Run `node spikes/06-detached-spawn/parent.mjs` with the Bash tool and show the output.
   ```

   Running it from the agent's Bash tool puts the child inside the agent's process tree,
   like a hook or MCP server would. Caveat: a Bash-tool subprocess is not identical to an MCP
   server (different stdio wiring, different shutdown signal), so if this passes, repeat once
   from a real stdio MCP server — the shim stub will do once it exists.
2. Exit Claude Code (`/exit`).
3. From a normal terminal: `./check.sh` (exit code 0 = pass). It requires the pid to be
   alive **and** a heartbeat from that pid in `~/.kommutator/spike06.log` within the last
   10 s, so a reused pid or a frozen child reads as FAIL. The child exits on its own after
   10 minutes, or `kill $(cat ~/.kommutator/spike06.pid)`.
4. Repeat on the Ubuntu server. Repeat with the ChatGPT app / Codex if convenient.

## Record

Per OS and per agent: survived / killed, in `../RESULTS.md`.
